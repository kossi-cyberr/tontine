import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { group_members as MemberRow, rounds as RoundRow } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertGroupManager,
  assertGroupMember,
  isPlatformAdmin,
  notFoundGroup,
  type Actor,
} from '../groups/permissions';
import {
  computeLatePenalty,
  expectedRoundAmount,
  generateDrawSeed,
  generateSchedule,
  seededShuffle,
  toUtcDate,
} from './calendar';

interface MemberWithUser extends MemberRow {
  users_group_members_user_idTousers: {
    full_name: string;
    phone: string;
    email: string | null;
    kyc: string;
    status: string;
  };
}

interface RoundWithRelations extends RoundRow {
  group_members: MemberWithUser;
  contributions: {
    id: string;
    member_id: string;
    amount: bigint;
    penalty_amount: bigint;
    status: string;
  }[];
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Helpers ----------

  private async requireGroup(groupId: string) {
    const group = await this.prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) notFoundGroup();
    return group;
  }

  private async membershipFor(userId: string, groupId: string) {
    return this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      select: { id: true, group_id: true, user_id: true, role: true, status: true },
    });
  }

  private async assertManager(actor: Actor, groupId: string) {
    const membership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, membership);
    return membership;
  }

  private async assertMember(actor: Actor, groupId: string) {
    const membership = await this.membershipFor(actor.id, groupId);
    if (!isPlatformAdmin(actor)) assertGroupMember(membership);
    return membership;
  }

  private participants(groupId: string) {
    return this.prisma.group_members.findMany({
      where: { group_id: groupId, status: 'active' },
      include: {
        users_group_members_user_idTousers: {
          select: { full_name: true, phone: true, email: true, kyc: true, status: true },
        },
      },
      orderBy: [{ position: 'asc' }, { joined_at: 'asc' }],
    });
  }

  private serializeParticipant(member: MemberWithUser) {
    return {
      id: member.id,
      user_id: member.user_id,
      full_name: member.users_group_members_user_idTousers.full_name,
      phone: member.users_group_members_user_idTousers.phone,
      role: member.role,
      status: member.status,
      position: member.position,
      shares: member.shares,
    };
  }

  private serializeRound(round: RoundWithRelations, viewerMemberId: string | null) {
    const contributions = round.contributions;
    const paid = contributions.filter((entry) => entry.status === 'paid');
    const mine = contributions.find((entry) => entry.member_id === viewerMemberId);

    return {
      id: round.id,
      cycle_id: round.cycle_id,
      group_id: round.group_id,
      round_number: round.round_number,
      status: round.status,
      opens_on: dateOnly(round.opens_on),
      due_date: dateOnly(round.due_date),
      payout_date: dateOnly(round.payout_date),
      expected_amount: Number(round.expected_amount),
      collected_amount: Number(round.collected_amount),
      beneficiary: {
        id: round.group_members.id,
        user_id: round.group_members.user_id,
        full_name: round.group_members.users_group_members_user_idTousers.full_name,
        phone: round.group_members.users_group_members_user_idTousers.phone,
        role: round.group_members.role,
        position: round.group_members.position,
      },
      contributions_count: contributions.length,
      paid_count: paid.length,
      paid_amount: paid.reduce((total, entry) => total + Number(entry.amount), 0),
      is_my_turn: viewerMemberId === round.group_members.id,
      my_contribution: mine
        ? {
            id: mine.id,
            amount: Number(mine.amount),
            penalty_amount: Number(mine.penalty_amount),
            status: mine.status,
          }
        : null,
    };
  }

  private async loadRound(roundId: string) {
    const round = await this.prisma.rounds.findUnique({
      where: { id: roundId },
      include: {
        group_members: {
          include: {
            users_group_members_user_idTousers: {
              select: { full_name: true, phone: true, email: true, kyc: true, status: true },
            },
          },
        },
        contributions: {
          select: {
            id: true,
            member_id: true,
            amount: true,
            penalty_amount: true,
            status: true,
          },
        },
      },
    });
    if (!round) {
      throw new BadRequestException({ code: 'ROUND_NOT_FOUND', message: 'Tour introuvable.' });
    }
    return round as RoundWithRelations;
  }

  private async roundWithViewer(actor: Actor, round: RoundWithRelations) {
    const membership = await this.membershipFor(actor.id, round.group_id);
    return this.serializeRound(round, membership?.id ?? null);
  }

  // ---------- Ordre et tirage ----------

  async draw(actor: Actor, groupId: string) {
    await this.assertManager(actor, groupId);
    const group = await this.requireGroup(groupId);

    if (group.launched_at) {
      throw new ConflictException({
        code: 'GROUP_LOCKED',
        message: 'Le groupe est lancé : l’ordre ne peut plus être tiré.',
      });
    }

    const participants = await this.participants(groupId);
    if (participants.length < 2) {
      throw new UnprocessableEntityException({
        code: 'NOT_ENOUGH_MEMBERS',
        message: 'Il faut au moins deux membres actifs pour tirer l’ordre.',
      });
    }

    const seed = generateDrawSeed();
    const shuffled = seededShuffle(participants, seed);
    const drawnAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      // La contrainte unique (group_id, position) impose de libérer les positions avant de les réattribuer.
      await tx.group_members.updateMany({
        where: { group_id: groupId, status: 'active' },
        data: { position: null },
      });
      for (let index = 0; index < shuffled.length; index += 1) {
        await tx.group_members.update({
          where: { id: shuffled[index]!.id },
          data: { position: index + 1 },
        });
      }

      const cycle = await tx.cycles.findFirst({
        where: { group_id: groupId, cycle_number: 1 },
        select: { id: true, status: true },
      });

      if (cycle) {
        if (cycle.status !== 'planned') {
          throw new ConflictException({
            code: 'GROUP_LOCKED',
            message: 'Le cycle a déjà démarré : l’ordre ne peut plus être tiré.',
          });
        }
        await tx.cycles.update({
          where: { id: cycle.id },
          data: { draw_seed: seed, drawn_at: drawnAt },
        });
      } else {
        await tx.cycles.create({
          data: {
            group_id: groupId,
            cycle_number: 1,
            start_date: group.start_date,
            status: 'planned',
            draw_seed: seed,
            drawn_at: drawnAt,
          },
        });
      }
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'group.draw',
      entity: 'groups',
      entityId: groupId,
      metadata: { members: shuffled.length, seed },
    });

    return {
      seed,
      drawn_at: drawnAt.toISOString(),
      order: shuffled.map((member, index) => ({
        ...this.serializeParticipant(member as MemberWithUser),
        position: index + 1,
      })),
    };
  }

  async setOrder(actor: Actor, groupId: string, memberIds: string[]) {
    await this.assertManager(actor, groupId);
    const group = await this.requireGroup(groupId);

    if (group.launched_at) {
      throw new ConflictException({
        code: 'GROUP_LOCKED',
        message: 'Le groupe est lancé : l’ordre est verrouillé.',
      });
    }

    const participants = await this.participants(groupId);
    const expected = new Set(participants.map((member) => member.id));
    const provided = new Set(memberIds);

    if (
      memberIds.length !== participants.length ||
      provided.size !== memberIds.length ||
      [...expected].some((id) => !provided.has(id))
    ) {
      throw new BadRequestException({
        code: 'ORDER_INCOMPLETE',
        message: 'L’ordre doit contenir une fois chaque membre actif du groupe.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.group_members.updateMany({
        where: { group_id: groupId, status: 'active' },
        data: { position: null },
      });
      for (let index = 0; index < memberIds.length; index += 1) {
        await tx.group_members.update({
          where: { id: memberIds[index]! },
          data: { position: index + 1 },
        });
      }

      // Un ordre manuel remplace un éventuel tirage : la graine n'est plus valable.
      await tx.cycles.updateMany({
        where: { group_id: groupId, cycle_number: 1, status: 'planned' },
        data: { draw_seed: null, drawn_at: null },
      });
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'group.set_order',
      entity: 'groups',
      entityId: groupId,
      metadata: { order: memberIds },
    });

    const ordered = await this.participants(groupId);
    return {
      message: 'Ordre enregistré.',
      order: ordered.map((member) => this.serializeParticipant(member as MemberWithUser)),
    };
  }

  // ---------- Lancement ----------

  async launch(actor: Actor, groupId: string) {
    await this.assertManager(actor, groupId);
    const group = await this.requireGroup(groupId);

    if (!isPlatformAdmin(actor)) {
      const membership = await this.membershipFor(actor.id, groupId);
      if (!membership?.id) {
        throw new ConflictException({
          code: 'NOT_A_MEMBER',
          message: 'Vous ne faites pas partie de ce groupe.',
        });
      }
      const own = await this.prisma.group_members.findUnique({
        where: { id: membership.id },
        select: { rules_accepted_at: true },
      });
      if (!own?.rules_accepted_at) {
        throw new UnprocessableEntityException({
          code: 'RULES_NOT_ACCEPTED',
          message: 'Vous devez accepter le règlement avant de lancer le groupe.',
        });
      }
    }

    if (group.launched_at) {
      throw new ConflictException({
        code: 'GROUP_ALREADY_LAUNCHED',
        message: 'Ce groupe est déjà lancé.',
      });
    }

    const participants = await this.participants(groupId);
    if (participants.length < group.min_members) {
      throw new UnprocessableEntityException({
        code: 'MIN_MEMBERS_NOT_REACHED',
        message: `Il faut au moins ${group.min_members} membres actifs pour lancer le groupe (actuellement ${participants.length}).`,
      });
    }
    if (participants.length > group.max_members) {
      throw new UnprocessableEntityException({
        code: 'MAX_MEMBERS_EXCEEDED',
        message: `Le groupe dépasse sa limite de ${group.max_members} membres.`,
      });
    }
    const positions = participants.map((member) => member.position);
    const orderComplete =
      positions.every((position) => position !== null) &&
      new Set(positions).size === participants.length;
    if (!orderComplete) {
      throw new UnprocessableEntityException({
        code: 'ORDER_INCOMPLETE',
        message: 'Définissez l’ordre de passage de tous les membres avant de lancer.',
      });
    }

    const ordered = [...participants].sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    );
    const schedule = generateSchedule(
      group.start_date,
      group.frequency,
      ordered.length,
      group.payment_deadline_days,
    );
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.groups.updateMany({
        where: { id: groupId, launched_at: null },
        data: { launched_at: now, status: 'active', updated_at: now },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          code: 'GROUP_ALREADY_LAUNCHED',
          message: 'Ce groupe est déjà lancé.',
        });
      }

      const existingCycle = await tx.cycles.findFirst({
        where: { group_id: groupId, cycle_number: 1 },
      });

      const cycle = existingCycle
        ? await tx.cycles.update({
            where: { id: existingCycle.id },
            data: {
              status: 'running',
              start_date: group.start_date,
              end_date: schedule[schedule.length - 1]?.payout_date ?? null,
            },
          })
        : await tx.cycles.create({
            data: {
              group_id: groupId,
              cycle_number: 1,
              start_date: group.start_date,
              end_date: schedule[schedule.length - 1]?.payout_date ?? null,
              status: 'running',
            },
          });

      const expectedAmount = expectedRoundAmount(
        ordered.length,
        Number(group.contribution_amount),
        group.beneficiary_pays,
      );

      for (let index = 0; index < ordered.length; index += 1) {
        const beneficiary = ordered[index]!;
        const dates = schedule[index]!;
        const round = await tx.rounds.create({
          data: {
            cycle_id: cycle.id,
            group_id: groupId,
            round_number: index + 1,
            beneficiary_member_id: beneficiary.id,
            opens_on: dates.opens_on,
            due_date: dates.due_date,
            payout_date: dates.payout_date,
            expected_amount: BigInt(expectedAmount),
            status: 'scheduled',
          },
        });

        const payers = group.beneficiary_pays
          ? ordered
          : ordered.filter((member) => member.id !== beneficiary.id);

        if (payers.length > 0) {
          await tx.contributions.createMany({
            data: payers.map((payer) => ({
              round_id: round.id,
              member_id: payer.id,
              amount: group.contribution_amount,
              due_date: dates.due_date,
              status: 'pending' as const,
            })),
          });
        }
      }

      await tx.escrow_accounts.upsert({
        where: { group_id: groupId },
        create: { group_id: groupId, currency: group.currency.trim(), balance_cached: 0n },
        update: {},
      });
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'group.launch',
      entity: 'groups',
      entityId: groupId,
      metadata: {
        rounds: ordered.length,
        expected_amount: expectedRoundAmount(
          ordered.length,
          Number(group.contribution_amount),
          group.beneficiary_pays,
        ),
      },
    });

    return {
      message: 'Groupe lancé. Le calendrier est généré.',
      group_id: groupId,
      launched_at: now.toISOString(),
      rounds_count: ordered.length,
      expected_amount: expectedRoundAmount(
        ordered.length,
        Number(group.contribution_amount),
        group.beneficiary_pays,
      ),
      order: ordered.map((member) => this.serializeParticipant(member as MemberWithUser)),
      rounds: await this.listRounds(actor, groupId),
    };
  }

  // ---------- Consultation ----------

  async listRounds(actor: Actor, groupId: string) {
    const membership = await this.assertMember(actor, groupId);
    await this.requireGroup(groupId);

    const rounds = await this.prisma.rounds.findMany({
      where: { group_id: groupId },
      include: {
        group_members: {
          include: {
            users_group_members_user_idTousers: {
              select: { full_name: true, phone: true, email: true, kyc: true, status: true },
            },
          },
        },
        contributions: {
          select: {
            id: true,
            member_id: true,
            amount: true,
            penalty_amount: true,
            status: true,
          },
        },
      },
      orderBy: { round_number: 'asc' },
    });

    return rounds.map((round) =>
      this.serializeRound(round as RoundWithRelations, membership?.id ?? null),
    );
  }

  async currentRound(actor: Actor, groupId: string) {
    const membership = await this.assertMember(actor, groupId);

    const round = await this.prisma.rounds.findFirst({
      where: {
        group_id: groupId,
        status: { in: ['scheduled', 'open', 'collecting', 'ready'] },
      },
      include: {
        group_members: {
          include: {
            users_group_members_user_idTousers: {
              select: { full_name: true, phone: true, email: true, kyc: true, status: true },
            },
          },
        },
        contributions: {
          select: {
            id: true,
            member_id: true,
            amount: true,
            penalty_amount: true,
            status: true,
          },
        },
      },
      orderBy: { round_number: 'asc' },
    });

    if (!round) return null;
    return this.serializeRound(round as RoundWithRelations, membership?.id ?? null);
  }

  async getRound(actor: Actor, roundId: string) {
    const round = await this.loadRound(roundId);
    await this.assertMember(actor, round.group_id);

    const membership = await this.membershipFor(actor.id, round.group_id);
    const contributions = await this.prisma.contributions.findMany({
      where: { round_id: roundId },
      include: {
        group_members: {
          include: {
            users_group_members_user_idTousers: {
              select: { full_name: true, phone: true, email: true, kyc: true, status: true },
            },
          },
        },
      },
      orderBy: { amount: 'desc' },
    });

    return {
      ...this.serializeRound(round, membership?.id ?? null),
      contributions: contributions.map((entry) => ({
        id: entry.id,
        amount: Number(entry.amount),
        penalty_amount: Number(entry.penalty_amount),
        status: entry.status,
        due_date: dateOnly(entry.due_date),
        paid_at: entry.paid_at ? entry.paid_at.toISOString() : null,
        member: {
          id: entry.group_members.id,
          full_name: entry.group_members.users_group_members_user_idTousers.full_name,
          phone: entry.group_members.users_group_members_user_idTousers.phone,
        },
      })),
    };
  }

  // ---------- Jobs idempotents ----------

  async openDueRounds(now = new Date()): Promise<{ opened: number }> {
    const today = toUtcDate(now);
    const due = await this.prisma.rounds.findMany({
      where: { status: 'scheduled', opens_on: { lte: today } },
      include: {
        groups: { select: { name: true, launched_at: true } },
        contributions: {
          where: { status: 'pending' },
          include: { group_members: { select: { user_id: true } } },
        },
      },
    });

    const result = await this.prisma.rounds.updateMany({
      where: { status: 'scheduled', opens_on: { lte: today } },
      data: { status: 'open' },
    });

    for (const round of due) {
      if (!round.groups.launched_at) continue;
      for (const contribution of round.contributions) {
        try {
          await this.notifications.notify({
            userId: contribution.group_members.user_id,
            template: 'round_opened',
            payload: {
              amount: Number(contribution.amount),
              group_name: round.groups.name,
              round_number: round.round_number,
            },
            dedupeKey: `round_opened:${round.id}:${contribution.id}`,
          });
        } catch {
          // Une notification ne doit jamais bloquer l'ouverture des tours.
        }
      }
    }

    return { opened: result.count };
  }

  async markLateContributions(now = new Date()): Promise<{ marked: number }> {
    const today = toUtcDate(now);
    const overdue = await this.prisma.contributions.findMany({
      where: { status: 'pending', due_date: { lt: today } },
      include: {
        group_members: { select: { user_id: true } },
        rounds: {
          select: {
            round_number: true,
            groups: { select: { name: true, late_fee_type: true, late_fee_value: true } },
          },
        },
      },
    });

    if (overdue.length === 0) return { marked: 0 };

    await this.prisma.$transaction(
      overdue.map((entry) =>
        this.prisma.contributions.updateMany({
          where: { id: entry.id, status: 'pending' },
          data: {
            status: 'late',
            penalty_amount: BigInt(
              computeLatePenalty(
                Number(entry.amount),
                entry.rounds.groups.late_fee_type,
                Number(entry.rounds.groups.late_fee_value),
              ),
            ),
          },
        }),
      ),
    );

    for (const entry of overdue) {
      const penalty = computeLatePenalty(
        Number(entry.amount),
        entry.rounds.groups.late_fee_type,
        Number(entry.rounds.groups.late_fee_value),
      );
      try {
        await this.notifications.notify({
          userId: entry.group_members.user_id,
          template: 'contribution_late',
          payload: {
            amount: penalty,
            group_name: entry.rounds.groups.name,
            round_number: entry.rounds.round_number,
          },
          dedupeKey: `late:${entry.id}`,
        });
      } catch {
        // Le marquage des retards ne dépend pas de l'envoi des notifications.
      }
    }

    return { marked: overdue.length };
  }

  /** Rappels J-3, J-1, J et J+1, uniquement aux membres non payeurs. */
  async sendRoundReminders(now = new Date()): Promise<{ sent: number }> {
    const today = toUtcDate(now);
    const rounds = await this.prisma.rounds.findMany({
      where: { status: { in: ['open', 'collecting'] } },
      include: {
        groups: { select: { name: true } },
        contributions: {
          where: { status: { in: ['pending', 'late'] } },
          include: { group_members: { select: { user_id: true } } },
        },
      },
    });

    const templates: Record<
      number,
      'reminder_j3' | 'reminder_j1' | 'reminder_j' | 'reminder_j1_late'
    > = {
      3: 'reminder_j3',
      1: 'reminder_j1',
      0: 'reminder_j',
      [-1]: 'reminder_j1_late',
    };

    let sent = 0;
    for (const round of rounds) {
      const offset = Math.round(
        (toUtcDate(round.due_date).getTime() - today.getTime()) / 86_400_000,
      );
      const template = templates[offset];
      if (!template) continue;

      const unpaid = round.contributions.filter((contribution) =>
        offset === -1 ? contribution.status === 'late' : contribution.status === 'pending',
      );

      for (const contribution of unpaid) {
        const result = await this.notifications.notify({
          userId: contribution.group_members.user_id,
          template,
          payload: {
            amount: Number(contribution.amount) + Number(contribution.penalty_amount),
            group_name: round.groups.name,
            round_number: round.round_number,
          },
          dedupeKey: `reminder:${template}:${contribution.id}`,
        });
        if (!result.skipped) sent += 1;
      }
    }

    return { sent };
  }

  /** Relance manuelle du président/trésorier vers les non-payeurs du tour courant. */
  async remindUnpaid(actor: Actor, groupId: string) {
    const membership = await this.membershipFor(actor.id, groupId);
    if (
      !isPlatformAdmin(actor) &&
      (!membership ||
        membership.status !== 'active' ||
        !['president', 'treasurer'].includes(membership.role))
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Seul le président ou le trésorier peut relancer les membres.',
      });
    }

    const round = await this.prisma.rounds.findFirst({
      where: { group_id: groupId, status: { in: ['open', 'collecting'] } },
      include: {
        groups: { select: { name: true } },
        contributions: {
          where: { status: { in: ['pending', 'late'] } },
          include: { group_members: { select: { user_id: true } } },
        },
      },
      orderBy: { round_number: 'asc' },
    });

    if (!round) {
      throw new UnprocessableEntityException({
        code: 'NO_OPEN_ROUND',
        message: 'Aucun tour ouvert à relancer.',
      });
    }

    const hour = new Date().toISOString().slice(0, 13);
    let sent = 0;
    for (const contribution of round.contributions) {
      const result = await this.notifications.notify({
        userId: contribution.group_members.user_id,
        template: 'reminder_manual',
        payload: {
          amount: Number(contribution.amount) + Number(contribution.penalty_amount),
          group_name: round.groups.name,
          round_number: round.round_number,
        },
        dedupeKey: `reminder_manual:${contribution.id}:${hour}`,
      });
      if (!result.skipped) sent += 1;
    }

    return {
      round_id: round.id,
      round_number: round.round_number,
      sent,
      message: `${sent} membre(s) relancé(s).`,
    };
  }
}
