import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertGroupManager,
  isPlatformAdmin,
  notFoundGroup,
  type Actor,
  type Membership,
} from '../groups/permissions';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_ROUND_STATUSES = ['open', 'collecting', 'ready'] as const;

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Neutralise les formules Excel : un nom commençant par =, +, - ou @
  // s'exécuterait à l'ouverture du fichier malgré les guillemets.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireMembership(actor: Actor, groupId: string) {
    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, contribution_amount: true, frequency: true, status: true },
    });
    if (!group) notFoundGroup();

    if (isPlatformAdmin(actor)) return { group, membership: null };

    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: actor.id } },
      select: { id: true, role: true, status: true, position: true },
    });
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException({
        code: 'NOT_A_MEMBER',
        message: 'Vous ne faites pas partie de ce groupe.',
      });
    }
    return { group, membership };
  }

  /** Tableau de bord agrégé du membre (R-01). */
  async memberDashboard(actor: Actor) {
    const memberships = await this.prisma.group_members.findMany({
      where: { user_id: actor.id, status: 'active' },
      select: {
        id: true,
        position: true,
        groups: { select: { id: true, name: true, currency: true, status: true } },
      },
    });

    const groupIds = memberships.map((membership) => membership.groups.id);
    const memberIds = memberships.map((membership) => membership.id);

    const [rounds, payments, paidAggregate] = await Promise.all([
      groupIds.length
        ? this.prisma.rounds.findMany({
            where: {
              group_id: { in: groupIds },
              status: { in: [...OPEN_ROUND_STATUSES] },
            },
            include: {
              group_members: {
                include: {
                  users_group_members_user_idTousers: { select: { full_name: true } },
                },
              },
              contributions: {
                where: { member_id: { in: memberIds } },
                select: {
                  id: true,
                  amount: true,
                  penalty_amount: true,
                  status: true,
                  due_date: true,
                },
              },
            },
            orderBy: { round_number: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.payments.findMany({
        where: { user_id: actor.id, status: 'confirmed' },
        select: { amount: true },
      }),
      this.prisma.contributions.aggregate({
        where: { member_id: { in: memberIds }, status: 'paid' },
        _sum: { amount: true, penalty_amount: true },
      }),
    ]);

    const groupById = new Map(memberships.map((membership) => [membership.groups.id, membership]));

    const turns: {
      group_id: string;
      group_name: string;
      round_id: string;
      round_number: number;
      payout_date: string;
      expected_amount: number;
      collected_amount: number;
    }[] = [];

    const due: {
      group_id: string;
      group_name: string;
      round_id: string;
      round_number: number;
      amount: number;
      due_date: string;
      status: string;
    }[] = [];

    for (const round of rounds) {
      const membership = groupById.get(round.group_id);
      if (!membership) continue;

      if (round.beneficiary_member_id === membership.id) {
        turns.push({
          group_id: round.group_id,
          group_name: membership.groups.name,
          round_id: round.id,
          round_number: round.round_number,
          payout_date: dateOnly(round.payout_date) ?? '',
          expected_amount: Number(round.expected_amount),
          collected_amount: Number(round.collected_amount),
        });
      }

      const mine = round.contributions[0];
      if (mine && ['pending', 'late'].includes(mine.status)) {
        due.push({
          group_id: round.group_id,
          group_name: membership.groups.name,
          round_id: round.id,
          round_number: round.round_number,
          amount: Number(mine.amount) + Number(mine.penalty_amount),
          due_date: dateOnly(mine.due_date) ?? '',
          status: mine.status,
        });
      }
    }

    due.sort((left, right) => left.due_date.localeCompare(right.due_date));
    turns.sort((left, right) => left.payout_date.localeCompare(right.payout_date));

    return {
      groups_count: memberships.length,
      total_paid:
        Number(paidAggregate._sum.amount ?? 0n) + Number(paidAggregate._sum.penalty_amount ?? 0n),
      payments_count: payments.length,
      next_payment: due[0] ?? null,
      upcoming_turns: turns.slice(0, 5),
    };
  }

  /** Tableau de bord du groupe, adapté au rôle du lecteur (R-01 / R-02). */
  async groupDashboard(actor: Actor, groupId: string) {
    const { group, membership } = await this.requireMembership(actor, groupId);

    const [rounds, escrow, contributions] = await Promise.all([
      this.prisma.rounds.findMany({
        where: { group_id: groupId },
        include: {
          group_members: {
            include: {
              users_group_members_user_idTousers: { select: { full_name: true, phone: true } },
            },
          },
        },
        orderBy: { round_number: 'asc' },
      }),
      this.prisma.escrow_accounts.findUnique({ where: { group_id: groupId } }),
      this.prisma.contributions.findMany({
        where: { rounds: { group_id: groupId } },
        include: {
          group_members: {
            include: {
              users_group_members_user_idTousers: { select: { full_name: true, phone: true } },
            },
          },
        },
      }),
    ]);

    const current =
      rounds.find((round) => (OPEN_ROUND_STATUSES as readonly string[]).includes(round.status)) ??
      rounds.find((round) => round.status === 'scheduled') ??
      null;
    const currentContributions = current
      ? contributions.filter((entry) => entry.round_id === current.id)
      : [];

    // Le taux de paiement porte sur le tour courant : les tours futurs ne sont
    // pas encore ouverts et ne doivent pas pénaliser le tableau de bord.
    const payable = currentContributions.filter((entry) => entry.status !== 'waived');
    const paid = payable.filter((entry) => entry.status === 'paid');
    const late = currentContributions.filter((entry) => entry.status === 'late');
    const paymentRate = payable.length === 0 ? 0 : Math.round((paid.length / payable.length) * 100);

    const lateByMember = new Map<
      string,
      { id: string; full_name: string; phone: string; late_count: number; unpaid: number }
    >();
    for (const entry of contributions) {
      if (!['late', 'pending'].includes(entry.status)) continue;
      const key = entry.member_id;
      const currentEntry = lateByMember.get(key) ?? {
        id: key,
        full_name: entry.group_members.users_group_members_user_idTousers.full_name,
        phone: entry.group_members.users_group_members_user_idTousers.phone,
        late_count: 0,
        unpaid: 0,
      };
      if (entry.status === 'late') currentEntry.late_count += 1;
      currentEntry.unpaid += 1;
      lateByMember.set(key, currentEntry);
    }
    const membersAtRisk = [...lateByMember.values()]
      .filter((entry) => entry.late_count >= 2)
      .sort((left, right) => right.late_count - left.late_count)
      .slice(0, 10);

    const mine = membership
      ? (currentContributions.find((entry) => entry.member_id === membership.id) ?? null)
      : null;

    return {
      group: {
        id: group.id,
        name: group.name,
        status: group.status,
        contribution_amount: Number(group.contribution_amount),
        frequency: group.frequency,
      },
      my_member: membership
        ? {
            id: membership.id,
            role: membership.role,
            position: membership.position,
          }
        : null,
      current_round: current
        ? {
            id: current.id,
            round_number: current.round_number,
            status: current.status,
            due_date: dateOnly(current.due_date),
            payout_date: dateOnly(current.payout_date),
            expected_amount: Number(current.expected_amount),
            collected_amount: Number(current.collected_amount),
            paid_count: currentContributions.filter((entry) => entry.status === 'paid').length,
            contributions_count: currentContributions.length,
            beneficiary: {
              id: current.group_members.id,
              full_name: current.group_members.users_group_members_user_idTousers.full_name,
              is_me: membership ? current.beneficiary_member_id === membership.id : false,
            },
          }
        : null,
      my_contribution: mine
        ? {
            id: mine.id,
            amount: Number(mine.amount),
            penalty_amount: Number(mine.penalty_amount),
            status: mine.status,
            due_date: dateOnly(mine.due_date),
          }
        : null,
      stats: {
        payment_rate: paymentRate,
        paid_count: paid.length,
        total_contributions: currentContributions.length,
        late_count: late.length,
        unpaid_count: currentContributions.filter((entry) =>
          ['pending', 'late'].includes(entry.status),
        ).length,
        escrow_balance: Number(escrow?.balance_cached ?? 0n),
        guarantee_balance: Number(escrow?.guarantee_balance ?? 0n),
        next_payout: current
          ? {
              round_number: current.round_number,
              beneficiary_name: current.group_members.users_group_members_user_idTousers.full_name,
              payout_date: dateOnly(current.payout_date),
              amount: Number(current.expected_amount),
              collected_amount: Number(current.collected_amount),
            }
          : null,
      },
      members_at_risk: membersAtRisk,
    };
  }

  /** Relevé du groupe au format CSV, réservé aux gestionnaires (données personnelles). */
  async statementCsv(actor: Actor, groupId: string) {
    const { group } = await this.requireMembership(actor, groupId);
    if (!isPlatformAdmin(actor)) {
      const membership = await this.prisma.group_members.findUnique({
        where: { group_id_user_id: { group_id: groupId, user_id: actor.id } },
        select: { id: true, group_id: true, user_id: true, role: true, status: true },
      });
      assertGroupManager(actor, membership as Membership | null);
    }

    const rounds = await this.prisma.rounds.findMany({
      where: { group_id: groupId },
      include: {
        group_members: {
          include: { users_group_members_user_idTousers: { select: { full_name: true } } },
        },
        contributions: {
          include: {
            group_members: {
              include: {
                users_group_members_user_idTousers: { select: { full_name: true, phone: true } },
              },
            },
          },
          orderBy: { member_id: 'asc' },
        },
      },
      orderBy: { round_number: 'asc' },
    });

    if (!rounds) {
      throw new NotFoundException({ code: 'GROUP_NOT_FOUND', message: 'Groupe introuvable.' });
    }

    const lines: string[] = [
      [
        'Tour',
        'Beneficiaire',
        'Echeance',
        'Membre',
        'Telephone',
        'Cotisation',
        'Penalite',
        'Statut',
        'Paye le',
      ]
        .map(csvCell)
        .join(';'),
    ];

    for (const round of rounds) {
      for (const entry of round.contributions) {
        lines.push(
          [
            round.round_number,
            round.group_members.users_group_members_user_idTousers.full_name,
            dateOnly(round.due_date),
            entry.group_members.users_group_members_user_idTousers.full_name,
            entry.group_members.users_group_members_user_idTousers.phone,
            Number(entry.amount),
            Number(entry.penalty_amount),
            entry.status,
            entry.paid_at ? entry.paid_at.toISOString() : '',
          ]
            .map(csvCell)
            .join(';'),
        );
      }
    }

    const filename = `releve-${group.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .slice(0, 40)}.csv`;

    return {
      filename,
      content: `\uFEFF${lines.join('\r\n')}\r\n`,
    };
  }
}
