import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { GroupRole, GroupStatus } from '@tontine/shared-types';
import type { groups as GroupRow, group_members as MemberRow } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assertGroupManager,
  assertGroupMember,
  isPlatformAdmin,
  notFoundGroup,
  type Actor,
  type Membership,
} from './permissions';
import type {
  AddMemberInput,
  CreateGroupInput,
  ReplaceMemberInput,
  UpdateGroupInput,
} from './groups.schemas';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const FROZEN_AFTER_LAUNCH: (keyof UpdateGroupInput)[] = [
  'contribution_amount',
  'frequency',
  'start_date',
  'min_members',
  'max_members',
  'payout_rule',
  'beneficiary_pays',
  'payment_deadline_days',
  'late_fee_type',
  'late_fee_value',
  'platform_fee_type',
  'platform_fee_value',
  'order_mode',
  'dual_approval_threshold',
];

interface MemberWithUser extends MemberRow {
  users_group_members_user_idTousers: {
    full_name: string;
    phone: string;
    email: string | null;
    kyc: string;
    status: string;
  };
}

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Helpers ----------

  private async platformLimits(): Promise<{
    groupMin: number;
    groupMax: number;
    contributionMin: number;
    contributionMax: number;
  }> {
    const rows = await this.prisma.platform_settings.findMany({
      where: { key: { in: ['group_limits', 'contribution_limits'] } },
    });

    const byKey = new Map(rows.map((row) => [row.key, row.value as Record<string, number>]));
    const groupLimits = byKey.get('group_limits') ?? { min: 10, max: 100 };
    const contributionLimits = byKey.get('contribution_limits') ?? { min: 1000, max: 5000000 };

    return {
      groupMin: Number(groupLimits['min'] ?? 10),
      groupMax: Number(groupLimits['max'] ?? 100),
      contributionMin: Number(contributionLimits['min'] ?? 1000),
      contributionMax: Number(contributionLimits['max'] ?? 5_000_000),
    };
  }

  private async membershipFor(userId: string, groupId: string): Promise<Membership | null> {
    return this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      select: { id: true, group_id: true, user_id: true, role: true, status: true },
    });
  }

  private async requireGroup(
    groupId: string,
  ): Promise<GroupRow & { group_members: MemberWithUser[] }> {
    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        group_members: {
          include: {
            users_group_members_user_idTousers: {
              select: { full_name: true, phone: true, email: true, kyc: true, status: true },
            },
          },
          orderBy: { joined_at: 'asc' },
        },
      },
    });

    if (!group) notFoundGroup();
    return group;
  }

  private async generateInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let code = '';
      for (let index = 0; index < 8; index += 1) {
        code += INVITE_ALPHABET[randomInt(0, INVITE_ALPHABET.length)];
      }
      const exists = await this.prisma.groups.findUnique({
        where: { invite_code: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new Error('Impossible de générer un code d’invitation unique');
  }

  private serializeGroup(
    group: GroupRow & { group_members?: Pick<MemberRow, 'user_id' | 'role' | 'status'>[] },
    viewer: { userId: string; platformRole: string },
  ) {
    const members = group.group_members ?? [];
    const myMembership = members.find((member) => member.user_id === viewer.userId);

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      rules_text: group.rules_text,
      contribution_amount: Number(group.contribution_amount),
      currency: group.currency.trim(),
      frequency: group.frequency,
      start_date: group.start_date.toISOString().slice(0, 10),
      min_members: group.min_members,
      max_members: group.max_members,
      payout_rule: group.payout_rule,
      beneficiary_pays: group.beneficiary_pays,
      payment_deadline_days: group.payment_deadline_days,
      late_fee_type: group.late_fee_type,
      late_fee_value: Number(group.late_fee_value),
      platform_fee_type: group.platform_fee_type,
      platform_fee_value: Number(group.platform_fee_value),
      order_mode: group.order_mode,
      dual_approval_threshold:
        group.dual_approval_threshold === null ? null : Number(group.dual_approval_threshold),
      invite_code: group.invite_code,
      status: group.status,
      created_at: group.created_at.toISOString(),
      launched_at: group.launched_at ? group.launched_at.toISOString() : null,
      members_count: members.filter((member) => member.status !== 'left').length,
      my_role: (myMembership?.role ?? null) as GroupRole | null,
    };
  }

  private serializeMember(member: MemberWithUser) {
    return {
      id: member.id,
      user_id: member.user_id,
      full_name: member.users_group_members_user_idTousers.full_name,
      phone: member.users_group_members_user_idTousers.phone,
      email: member.users_group_members_user_idTousers.email,
      kyc: member.users_group_members_user_idTousers.kyc,
      user_status: member.users_group_members_user_idTousers.status,
      role: member.role,
      status: member.status,
      position: member.position,
      shares: member.shares,
      risk_flag: member.risk_flag,
      rules_accepted_at: member.rules_accepted_at ? member.rules_accepted_at.toISOString() : null,
      joined_at: member.joined_at ? member.joined_at.toISOString() : null,
    };
  }

  // ---------- Groupes ----------

  async create(actor: Actor, input: CreateGroupInput) {
    const limits = await this.platformLimits();

    if (input.contribution_amount < limits.contributionMin) {
      throw new UnprocessableEntityException({
        code: 'CONTRIBUTION_TOO_LOW',
        message: `La cotisation minimale est de ${limits.contributionMin} XAF.`,
      });
    }
    if (input.contribution_amount > limits.contributionMax) {
      throw new UnprocessableEntityException({
        code: 'CONTRIBUTION_TOO_HIGH',
        message: `La cotisation maximale est de ${limits.contributionMax} XAF.`,
      });
    }
    if (input.min_members < limits.groupMin) {
      throw new UnprocessableEntityException({
        code: 'MIN_MEMBERS_TOO_LOW',
        message: `Un groupe doit prévoir au moins ${limits.groupMin} membres.`,
      });
    }
    if (input.max_members > limits.groupMax) {
      throw new UnprocessableEntityException({
        code: 'MAX_MEMBERS_TOO_HIGH',
        message: `Un groupe ne peut pas dépasser ${limits.groupMax} membres.`,
      });
    }
    if (input.start_date < new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException({
        code: 'START_DATE_IN_PAST',
        message: 'La date de début ne peut pas être dans le passé.',
      });
    }

    const group = await this.prisma.$transaction(async (tx) => {
      const created = await tx.groups.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          rules_text: input.rules_text ?? null,
          contribution_amount: input.contribution_amount,
          frequency: input.frequency,
          payment_deadline_days: input.payment_deadline_days,
          start_date: new Date(`${input.start_date}T00:00:00.000Z`),
          min_members: input.min_members,
          max_members: input.max_members,
          payout_rule: input.payout_rule,
          beneficiary_pays: input.beneficiary_pays,
          late_fee_type: input.late_fee_type,
          late_fee_value: input.late_fee_value,
          platform_fee_type: input.platform_fee_type,
          platform_fee_value: input.platform_fee_value,
          order_mode: input.order_mode,
          dual_approval_threshold: input.dual_approval_threshold ?? null,
          invite_code: await this.generateInviteCode(),
          status: 'recruiting',
          created_by: actor.id,
        },
      });

      await tx.group_members.create({
        data: {
          group_id: created.id,
          user_id: actor.id,
          role: 'president',
          status: 'active',
          approved_by: actor.id,
          joined_at: new Date(),
          rules_accepted_at: new Date(),
        },
      });

      return created;
    });

    return this.serializeGroup(
      {
        ...group,
        group_members: [{ user_id: actor.id, role: 'president', status: 'active' }],
      },
      { userId: actor.id, platformRole: actor.platform_role },
    );
  }

  async listForUser(actor: Actor) {
    const memberships = await this.prisma.group_members.findMany({
      where: { user_id: actor.id, status: { not: 'left' } },
      include: {
        groups: {
          include: {
            group_members: { select: { user_id: true, role: true, status: true } },
          },
        },
      },
      orderBy: { joined_at: 'desc' },
    });

    return memberships.map((membership) =>
      this.serializeGroup(membership.groups, {
        userId: actor.id,
        platformRole: actor.platform_role,
      }),
    );
  }

  async getById(actor: Actor, groupId: string) {
    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        group_members: {
          select: { user_id: true, role: true, status: true, rules_accepted_at: true },
        },
      },
    });
    if (!group) notFoundGroup();

    const membership = group.group_members.find((member) => member.user_id === actor.id);
    if (!isPlatformAdmin(actor)) {
      assertGroupMember(membership ?? null);
    }

    const cycle = await this.prisma.cycles.findFirst({
      where: { group_id: groupId, cycle_number: 1 },
      select: { draw_seed: true, drawn_at: true },
    });

    return {
      ...this.serializeGroup(group, { userId: actor.id, platformRole: actor.platform_role }),
      my_rules_accepted_at:
        membership && 'rules_accepted_at' in membership && membership.rules_accepted_at
          ? membership.rules_accepted_at.toISOString()
          : null,
      draw_seed: cycle?.draw_seed ?? null,
      drawn_at: cycle?.drawn_at ? cycle.drawn_at.toISOString() : null,
    };
  }

  async update(actor: Actor, groupId: string, input: UpdateGroupInput) {
    const group = await this.requireGroup(groupId);
    const membership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, membership);

    if (group.launched_at) {
      const attempted = FROZEN_AFTER_LAUNCH.filter((field) => input[field] !== undefined);
      if (attempted.length > 0) {
        throw new ConflictException({
          code: 'GROUP_LOCKED',
          message: 'Les règles financières et l’ordre sont figés depuis le lancement du groupe.',
          details: { champs: attempted },
        });
      }
    }

    const min = input.min_members ?? group.min_members;
    const max = input.max_members ?? group.max_members;
    if (max < min) {
      throw new BadRequestException({
        code: 'INVALID_MEMBER_RANGE',
        message: 'Le maximum de membres doit être supérieur ou égal au minimum.',
      });
    }

    const limits = await this.platformLimits();
    if (min < limits.groupMin) {
      throw new UnprocessableEntityException({
        code: 'MIN_MEMBERS_TOO_LOW',
        message: `Un groupe doit prévoir au moins ${limits.groupMin} membres.`,
      });
    }
    if (max > limits.groupMax) {
      throw new UnprocessableEntityException({
        code: 'MAX_MEMBERS_TOO_HIGH',
        message: `Un groupe ne peut pas dépasser ${limits.groupMax} membres.`,
      });
    }

    const updated = await this.prisma.groups.update({
      where: { id: groupId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.rules_text !== undefined ? { rules_text: input.rules_text } : {}),
        ...(input.contribution_amount !== undefined
          ? { contribution_amount: input.contribution_amount }
          : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.start_date !== undefined
          ? { start_date: new Date(`${input.start_date}T00:00:00.000Z`) }
          : {}),
        ...(input.min_members !== undefined ? { min_members: input.min_members } : {}),
        ...(input.max_members !== undefined ? { max_members: input.max_members } : {}),
        ...(input.payout_rule !== undefined ? { payout_rule: input.payout_rule } : {}),
        ...(input.beneficiary_pays !== undefined
          ? { beneficiary_pays: input.beneficiary_pays }
          : {}),
        ...(input.payment_deadline_days !== undefined
          ? { payment_deadline_days: input.payment_deadline_days }
          : {}),
        ...(input.late_fee_type !== undefined ? { late_fee_type: input.late_fee_type } : {}),
        ...(input.late_fee_value !== undefined ? { late_fee_value: input.late_fee_value } : {}),
        ...(input.platform_fee_type !== undefined
          ? { platform_fee_type: input.platform_fee_type }
          : {}),
        ...(input.platform_fee_value !== undefined
          ? { platform_fee_value: input.platform_fee_value }
          : {}),
        ...(input.order_mode !== undefined ? { order_mode: input.order_mode } : {}),
        ...(input.dual_approval_threshold !== undefined
          ? { dual_approval_threshold: input.dual_approval_threshold }
          : {}),
        updated_at: new Date(),
      },
    });

    return this.serializeGroup(updated, {
      userId: actor.id,
      platformRole: actor.platform_role,
    });
  }

  async join(actor: Actor, inviteCode: string) {
    const group = await this.prisma.groups.findUnique({
      where: { invite_code: inviteCode },
      select: { id: true, status: true, name: true },
    });
    if (!group) {
      throw new BadRequestException({
        code: 'INVALID_INVITE_CODE',
        message: 'Code d’invitation invalide.',
      });
    }
    if (!['recruiting', 'draft'].includes(group.status)) {
      throw new ConflictException({
        code: 'GROUP_NOT_JOINABLE',
        message: 'Ce groupe n’accepte plus de nouvelles demandes.',
      });
    }

    const existing = await this.membershipFor(actor.id, group.id);
    if (existing) {
      throw new ConflictException({
        code: existing.status === 'pending' ? 'JOIN_ALREADY_PENDING' : 'ALREADY_MEMBER',
        message:
          existing.status === 'pending'
            ? 'Votre demande est déjà en attente de validation.'
            : 'Vous êtes déjà membre de ce groupe.',
      });
    }

    await this.prisma.group_members.create({
      data: {
        group_id: group.id,
        user_id: actor.id,
        role: 'member',
        status: 'pending',
      },
    });

    return {
      message: `Demande envoyée. Le président de « ${group.name} » doit la valider.`,
      group_id: group.id,
    };
  }

  async acceptRules(actor: Actor, groupId: string) {
    const membership = await this.membershipFor(actor.id, groupId);
    assertGroupMember(membership);

    await this.prisma.group_members.update({
      where: { id: membership!.id },
      data: { rules_accepted_at: new Date() },
    });

    return { message: 'Règlement accepté.', rules_accepted_at: new Date().toISOString() };
  }

  // ---------- Membres ----------

  async listMembers(
    actor: Actor,
    groupId: string,
    query: { status?: string; page: number; page_size: number },
  ) {
    const membership = await this.membershipFor(actor.id, groupId);
    if (!isPlatformAdmin(actor)) assertGroupMember(membership);

    await this.requireGroup(groupId);

    const members = await this.prisma.group_members.findMany({
      where: {
        group_id: groupId,
        ...(query.status
          ? { status: query.status as 'invited' | 'pending' | 'active' | 'suspended' | 'left' }
          : {}),
      },
      include: {
        users_group_members_user_idTousers: {
          select: { full_name: true, phone: true, email: true, kyc: true, status: true },
        },
      },
      orderBy: [{ role: 'asc' }, { joined_at: 'asc' }],
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
    });

    return members.map((member) => this.serializeMember(member as MemberWithUser));
  }

  private async createMemberForGroup(
    actor: Actor,
    group: GroupRow,
    input: AddMemberInput,
  ): Promise<{ member: ReturnType<GroupsService['serializeMember']>; activation_sent: boolean }> {
    const limits = await this.platformLimits();
    const count = await this.prisma.group_members.count({
      where: { group_id: group.id, status: { not: 'left' } },
    });
    const ceiling = Math.min(group.max_members, limits.groupMax);

    if (count >= ceiling) {
      throw new UnprocessableEntityException({
        code: 'MEMBER_LIMIT_REACHED',
        message: `Ce groupe a atteint sa limite de ${ceiling} membres.`,
      });
    }

    let user = await this.prisma.users.findUnique({
      where: { phone: input.phone },
      select: { id: true, status: true, full_name: true, phone: true, email: true },
    });

    if (!user) {
      try {
        user = await this.prisma.users.create({
          data: {
            full_name: input.full_name,
            phone: input.phone,
            email: input.email ?? null,
            status: 'pending',
            created_by: actor.id,
          },
          select: { id: true, status: true, full_name: true, phone: true, email: true },
        });
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw new ConflictException({
            code: 'EMAIL_TAKEN',
            message: 'Cette adresse email est déjà utilisée par un autre compte.',
          });
        }
        throw error;
      }
    }

    const existingMembership = await this.membershipFor(user.id, group.id);
    if (existingMembership) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'Cette personne fait déjà partie du groupe.',
      });
    }

    const active = user.status === 'active';
    const member = await this.prisma.group_members.create({
      data: {
        group_id: group.id,
        user_id: user.id,
        role: input.role,
        status: active ? 'active' : 'invited',
        invited_by: actor.id,
        approved_by: actor.id,
        joined_at: active ? new Date() : null,
      },
      include: {
        users_group_members_user_idTousers: {
          select: { full_name: true, phone: true, email: true, kyc: true, status: true },
        },
      },
    });

    if (!active) {
      await this.auth.sendActivationLink(user);
    }

    return {
      member: this.serializeMember(member as MemberWithUser),
      activation_sent: !active,
    };
  }

  async addMember(actor: Actor, groupId: string, input: AddMemberInput) {
    const group = await this.requireGroup(groupId);
    const membership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, membership);

    if (group.launched_at) {
      throw new ConflictException({
        code: 'GROUP_LOCKED',
        message: 'Le groupe est lancé : la liste des membres est verrouillée.',
      });
    }

    return this.createMemberForGroup(actor, group, input);
  }

  async importCsv(
    actor: Actor,
    groupId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    const group = await this.requireGroup(groupId);
    const membership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, membership);

    if (group.launched_at) {
      throw new ConflictException({
        code: 'GROUP_LOCKED',
        message: 'Le groupe est lancé : la liste des membres est verrouillée.',
      });
    }

    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Fichier CSV requis.' });
    }

    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

    const errors: { line: number; message: string }[] = [];
    let created = 0;
    let skipped = 0;

    if (lines.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Le fichier CSV est vide.' });
    }

    const delimiter =
      (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
    const parseLine = (line: string): string[] => {
      const cells: string[] = [];
      let current = '';
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
          if (quoted && line[index + 1] === '"') {
            current += '"';
            index += 1;
          } else {
            quoted = !quoted;
          }
        } else if (char === delimiter && !quoted) {
          cells.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim());
      return cells;
    };

    const header = parseLine(lines[0]!).map((cell) => cell.toLowerCase());
    const hasHeader = header.includes('phone') || header.includes('telephone');
    const column = (name: string, fallback: number): number => {
      const index = header.indexOf(name);
      return index === -1 ? fallback : index;
    };
    const indexes = hasHeader
      ? {
          fullName: column('full_name', 0),
          phone: column('phone', 1),
          email: column('email', 2),
        }
      : { fullName: 0, phone: 1, email: 2 };

    for (let index = hasHeader ? 1 : 0; index < lines.length; index += 1) {
      const lineNumber = index + 1;
      const cells = parseLine(lines[index]!);

      try {
        const fullName = cells[indexes.fullName]?.trim() ?? '';
        const rawPhone = cells[indexes.phone]?.trim() ?? '';
        const phone = rawPhone.replace(/[\s.-]/g, '');
        const email = cells[indexes.email]?.trim() || undefined;

        if (!fullName || !/^\+237\d{8,9}$/.test(phone)) {
          throw new Error('nom ou téléphone invalide (format +237…)');
        }

        await this.createMemberForGroup(actor, group, {
          full_name: fullName,
          phone,
          ...(email ? { email } : {}),
          role: 'member',
        });
        created += 1;
      } catch (error) {
        const payload =
          error instanceof HttpException
            ? (error.getResponse() as Record<string, unknown>)
            : undefined;
        if (payload?.['code'] === 'ALREADY_MEMBER') {
          skipped += 1;
          continue;
        }
        if (error instanceof ForbiddenException) throw error;
        errors.push({
          line: lineNumber,
          message: error instanceof Error ? error.message : 'ligne invalide',
        });
      }
    }

    return { created, skipped, errors };
  }

  async approveMember(actor: Actor, groupId: string, memberId: string) {
    const membership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, membership);

    await this.requireGroup(groupId).then((group) => {
      if (group.launched_at) {
        throw new ConflictException({
          code: 'GROUP_LOCKED',
          message: 'Le groupe est lancé : la liste des membres est verrouillée.',
        });
      }
    });

    const target = await this.prisma.group_members.findUnique({
      where: { id: memberId },
      include: { users_group_members_user_idTousers: { select: { status: true } } },
    });
    if (!target || target.group_id !== groupId) {
      throw new BadRequestException({ code: 'MEMBER_NOT_FOUND', message: 'Membre introuvable.' });
    }
    if (target.users_group_members_user_idTousers.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'USER_NOT_ACTIVATED',
        message: 'Cette personne n’a pas encore activé son compte.',
      });
    }
    if (target.status === 'left') {
      throw new ConflictException({
        code: 'MEMBER_LEFT',
        message: 'Ce membre a quitté le groupe.',
      });
    }

    const updated = await this.prisma.group_members.update({
      where: { id: memberId },
      data: {
        status: 'active',
        approved_by: actor.id,
        joined_at: target.joined_at ?? new Date(),
      },
      include: {
        users_group_members_user_idTousers: {
          select: { full_name: true, phone: true, email: true, kyc: true, status: true },
        },
      },
    });

    return this.serializeMember(updated as MemberWithUser);
  }

  async changeRole(actor: Actor, groupId: string, memberId: string, role: GroupRole) {
    const actorMembership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, actorMembership);

    const target = await this.prisma.group_members.findUnique({ where: { id: memberId } });
    if (!target || target.group_id !== groupId) {
      throw new BadRequestException({ code: 'MEMBER_NOT_FOUND', message: 'Membre introuvable.' });
    }
    if (target.status === 'left') {
      throw new ConflictException({
        code: 'MEMBER_LEFT',
        message: 'Ce membre a quitté le groupe.',
      });
    }
    if (target.user_id === actor.id && !isPlatformAdmin(actor)) {
      throw new ForbiddenException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message: 'Vous ne pouvez pas modifier votre propre rôle.',
      });
    }
    if (target.role === 'president' && !isPlatformAdmin(actor)) {
      throw new ForbiddenException({
        code: 'CANNOT_CHANGE_PRESIDENT',
        message: 'Seul un Super Admin peut modifier le rôle du président.',
      });
    }
    if (role === 'president' && !isPlatformAdmin(actor)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Seul un Super Admin peut nommer un président.',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (role === 'president' && isPlatformAdmin(actor)) {
        await tx.group_members.updateMany({
          where: { group_id: groupId, role: 'president', id: { not: target.id } },
          data: { role: 'member' },
        });
      }
      return tx.group_members.update({
        where: { id: target.id },
        data: { role },
        include: {
          users_group_members_user_idTousers: {
            select: { full_name: true, phone: true, email: true, kyc: true, status: true },
          },
        },
      });
    });

    return this.serializeMember(updated as MemberWithUser);
  }

  async suspendMember(actor: Actor, groupId: string, memberId: string) {
    const actorMembership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, actorMembership);

    const target = await this.prisma.group_members.findUnique({ where: { id: memberId } });
    if (!target || target.group_id !== groupId) {
      throw new BadRequestException({ code: 'MEMBER_NOT_FOUND', message: 'Membre introuvable.' });
    }
    if (target.user_id === actor.id) {
      throw new ForbiddenException({
        code: 'CANNOT_SUSPEND_SELF',
        message: 'Vous ne pouvez pas vous suspendre vous-même.',
      });
    }
    if (target.role === 'president' && !isPlatformAdmin(actor)) {
      throw new ForbiddenException({
        code: 'CANNOT_SUSPEND_PRESIDENT',
        message: 'Seul un Super Admin peut suspendre le président.',
      });
    }

    const updated = await this.prisma.group_members.update({
      where: { id: target.id },
      data: { status: 'suspended' },
      include: {
        users_group_members_user_idTousers: {
          select: { full_name: true, phone: true, email: true, kyc: true, status: true },
        },
      },
    });

    return this.serializeMember(updated as MemberWithUser);
  }

  /**
   * Remplace un membre par un autre utilisateur déjà inscrit : la position,
   * les dettes et les cotisations à venir sont transférées, l'historique reste
   * attaché à l'ancien membre.
   */
  async replaceMember(actor: Actor, groupId: string, memberId: string, input: ReplaceMemberInput) {
    const group = await this.requireGroup(groupId);
    const actorMembership = await this.membershipFor(actor.id, groupId);
    assertGroupManager(actor, actorMembership);

    const target = await this.prisma.group_members.findUnique({
      where: { id: memberId },
      include: { users_group_members_user_idTousers: { select: { full_name: true } } },
    });
    if (!target || target.group_id !== groupId) {
      throw new BadRequestException({ code: 'MEMBER_NOT_FOUND', message: 'Membre introuvable.' });
    }
    if (target.status === 'left') {
      throw new ConflictException({
        code: 'MEMBER_LEFT',
        message: 'Ce membre a déjà quitté le groupe.',
      });
    }
    if (target.role !== 'member') {
      throw new ConflictException({
        code: 'CANNOT_REPLACE_MANAGER',
        message: 'Seul un membre simple peut être remplacé. Changez d’abord son rôle.',
      });
    }

    const replacement = await this.prisma.users.findUnique({
      where: { phone: input.phone },
      select: { id: true, full_name: true, status: true },
    });
    if (!replacement) {
      throw new UnprocessableEntityException({
        code: 'REPLACEMENT_NOT_FOUND',
        message:
          'Aucun compte actif ne correspond à ce numéro. La personne doit d’abord s’inscrire.',
      });
    }
    if (replacement.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'REPLACEMENT_NOT_ACTIVE',
        message: 'Le compte de remplacement n’est pas encore activé.',
      });
    }
    if (replacement.id === target.user_id) {
      throw new BadRequestException({
        code: 'SAME_MEMBER',
        message: 'Le remplaçant est déjà le membre concerné.',
      });
    }
    const alreadyMember = await this.membershipFor(replacement.id, groupId);
    if (alreadyMember) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'Cette personne fait déjà partie du groupe.',
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.group_members.update({
        where: { id: target.id },
        data: { status: 'left', left_at: new Date(), position: null },
      });

      const created = await tx.group_members.create({
        data: {
          group_id: groupId,
          user_id: replacement.id,
          role: 'member',
          status: 'active',
          position: target.position,
          shares: target.shares,
          risk_flag: target.risk_flag,
          invited_by: actor.id,
          approved_by: actor.id,
          joined_at: new Date(),
          rules_accepted_at: target.rules_accepted_at ?? new Date(),
        },
        include: {
          users_group_members_user_idTousers: {
            select: { full_name: true, phone: true, email: true, kyc: true, status: true },
          },
        },
      });

      const debts = await tx.member_debts.updateMany({
        where: { member_id: target.id },
        data: { member_id: created.id },
      });

      const contributions = await tx.contributions.updateMany({
        where: {
          member_id: target.id,
          status: 'pending',
          rounds: { status: { in: ['scheduled', 'open'] } },
        },
        data: { member_id: created.id },
      });

      const rounds = await tx.rounds.updateMany({
        where: {
          group_id: groupId,
          beneficiary_member_id: target.id,
          status: { in: ['scheduled', 'open', 'collecting', 'ready'] },
        },
        data: { beneficiary_member_id: created.id },
      });

      return {
        created,
        debts: debts.count,
        contributions: contributions.count,
        rounds: rounds.count,
      };
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'member.replace',
      entity: 'group_members',
      entityId: result.created.id,
      metadata: {
        group_id: groupId,
        replaced_member_id: target.id,
        replacement_user_id: replacement.id,
        debts_transferred: result.debts,
        contributions_transferred: result.contributions,
        rounds_transferred: result.rounds,
      },
    });

    for (const notification of [
      {
        userId: replacement.id,
        message: `Vous remplacez ${target.users_group_members_user_idTousers.full_name} et reprenez sa position, ses dettes et ses cotisations à venir.`,
        dedupeKey: `member-replaced:${result.created.id}:new`,
      },
      {
        userId: target.user_id,
        message: `${replacement.full_name} vous remplace dans « ${group.name} ». Vos cotisations à venir sont transférées.`,
        dedupeKey: `member-replaced:${target.id}:old`,
      },
    ]) {
      try {
        await this.notifications.notify({
          userId: notification.userId,
          template: 'member_replaced',
          payload: { group_name: group.name, message: notification.message },
          dedupeKey: notification.dedupeKey,
        });
      } catch {
        // Notification best-effort.
      }
    }

    return {
      member: this.serializeMember(result.created as MemberWithUser),
      transferred: {
        debts: result.debts,
        contributions: result.contributions,
        rounds: result.rounds,
      },
    };
  }

  /** Utilisé par les tests et les phases suivantes : force un statut. */
  async statusOf(groupId: string): Promise<GroupStatus> {
    const group = await this.prisma.groups.findUniqueOrThrow({
      where: { id: groupId },
      select: { status: true },
    });
    return group.status;
  }
}
