import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminGroupsQuery,
  AdminUsersQuery,
  CancelRoundInput,
  KycDecisionInput,
  SettingsUpdateInput,
} from './admin.schemas';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async stats() {
    const [users, activeUsers, kycPending, groups, activeGroups, escrow, openDisputes, mismatches] =
      await Promise.all([
        this.prisma.users.count(),
        this.prisma.users.count({ where: { status: 'active' } }),
        this.prisma.users.count({ where: { kyc: 'submitted' } }),
        this.prisma.groups.count(),
        this.prisma.groups.count({ where: { status: 'active' } }),
        this.prisma.escrow_accounts.aggregate({
          _sum: { balance_cached: true, guarantee_balance: true },
        }),
        this.prisma.disputes.count({ where: { status: { in: ['open', 'in_review'] } } }),
        this.prisma.reconciliations.count({ where: { status: 'mismatch' } }),
      ]);

    return {
      users_total: users,
      users_active: activeUsers,
      kyc_pending: kycPending,
      groups_total: groups,
      groups_active: activeGroups,
      escrow_total: Number(escrow._sum.balance_cached ?? 0n),
      guarantee_total: Number(escrow._sum.guarantee_balance ?? 0n),
      disputes_open: openDisputes,
      reconciliation_mismatches: mismatches,
    };
  }

  async listGroups(query: AdminGroupsQuery) {
    const where: Prisma.groupsWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { invite_code: { equals: query.search.toUpperCase() } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.groups.count({ where }),
      this.prisma.groups.findMany({
        where,
        include: {
          escrow_accounts: { select: { balance_cached: true, guarantee_balance: true } },
          _count: { select: { group_members: true, rounds: true } },
          users: { select: { full_name: true, phone: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
    ]);

    return {
      total,
      page: query.page,
      page_size: query.page_size,
      items: rows.map((group) => ({
        id: group.id,
        name: group.name,
        status: group.status,
        contribution_amount: Number(group.contribution_amount),
        currency: group.currency.trim(),
        frequency: group.frequency,
        members_count: group._count.group_members,
        rounds_count: group._count.rounds,
        escrow_balance: Number(group.escrow_accounts?.balance_cached ?? 0n),
        guarantee_balance: Number(group.escrow_accounts?.guarantee_balance ?? 0n),
        president_name: group.users?.full_name ?? null,
        president_phone: group.users?.phone ?? null,
        created_at: group.created_at.toISOString(),
      })),
    };
  }

  async listUsers(query: AdminUsersQuery) {
    const where: Prisma.usersWhereInput = {
      ...(query.kyc ? { kyc: query.kyc } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { full_name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.users.count({ where }),
      this.prisma.users.findMany({
        where,
        select: {
          id: true,
          full_name: true,
          phone: true,
          email: true,
          platform_role: true,
          status: true,
          kyc: true,
          id_document_url: true,
          created_at: true,
          _count: {
            select: { group_members_group_members_user_idTousers: true, payments: true },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
    ]);

    return {
      total,
      page: query.page,
      page_size: query.page_size,
      items: rows.map((user) => ({
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        platform_role: user.platform_role,
        status: user.status,
        kyc: user.kyc,
        id_document_url: user.id_document_url,
        groups_count: user._count.group_members_group_members_user_idTousers,
        payments_count: user._count.payments,
        created_at: user.created_at.toISOString(),
      })),
    };
  }

  async decideKyc(actorId: string, userId: string, input: KycDecisionInput) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Utilisateur introuvable.' });
    }
    if (user.kyc !== 'submitted' && user.kyc !== input.decision) {
      throw new ConflictException({
        code: 'KYC_NOT_SUBMITTED',
        message: 'Cet utilisateur n’a pas de dossier KYC en attente.',
      });
    }

    const updated = await this.prisma.users.update({
      where: { id: userId },
      data: { kyc: input.decision, updated_at: new Date() },
      select: { id: true, kyc: true },
    });

    await this.audit.record({
      actorId,
      action: input.decision === 'verified' ? 'kyc.verify' : 'kyc.reject',
      entity: 'users',
      entityId: userId,
      metadata: { reason: input.reason ?? null },
    });

    try {
      await this.notifications.notify({
        userId,
        template: input.decision === 'verified' ? 'kyc_verified' : 'kyc_rejected',
        payload: { reason: input.reason ?? '' },
        dedupeKey: `kyc:${userId}:${input.decision}:${Date.now()}`,
      });
    } catch {
      // La décision KYC reste valable même si la notification échoue.
    }

    return updated;
  }

  async listSettings() {
    const rows = await this.prisma.platform_settings.findMany({ orderBy: { key: 'asc' } });
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updated_by: row.updated_by,
      updated_at: row.updated_at.toISOString(),
    }));
  }

  async updateSettings(actorId: string, input: SettingsUpdateInput) {
    const existing = await this.prisma.platform_settings.findMany({
      where: { key: { in: input.settings.map((setting) => setting.key) } },
      select: { key: true },
    });
    const known = new Set(existing.map((row) => row.key));
    const unknown = input.settings.map((setting) => setting.key).filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_SETTING',
        message: `Paramètre inconnu : ${unknown.join(', ')}.`,
      });
    }

    await this.prisma.$transaction(
      input.settings.map((setting) =>
        this.prisma.platform_settings.update({
          where: { key: setting.key },
          data: {
            value: setting.value as Prisma.InputJsonValue,
            updated_by: actorId,
            updated_at: new Date(),
          },
        }),
      ),
    );

    await this.audit.record({
      actorId,
      action: 'settings.update',
      entity: 'platform_settings',
      metadata: { keys: input.settings.map((setting) => setting.key) },
    });

    return this.listSettings();
  }

  /**
   * Annule un tour et rembourse les cotisations déjà encaissées par des
   * écritures correctives : le grand livre n'est jamais modifié, seulement
   * complété par des débits symétriques.
   */
  async cancelRound(actorId: string, roundId: string, input: CancelRoundInput) {
    const round = await this.prisma.rounds.findUnique({
      where: { id: roundId },
      include: {
        groups: { select: { id: true, name: true } },
        contributions: {
          where: { status: 'paid' },
          include: {
            payments: {
              where: { status: 'confirmed' },
              orderBy: { confirmed_at: 'desc' },
              take: 1,
            },
            group_members: { select: { user_id: true } },
          },
        },
        payouts: { where: { status: { in: ['success', 'processing'] } } },
      },
    });
    if (!round) {
      throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Tour introuvable.' });
    }
    if (round.status === 'cancelled') {
      throw new ConflictException({ code: 'ROUND_CANCELLED', message: 'Ce tour est déjà annulé.' });
    }
    if (round.status === 'paid_out' || round.payouts.length > 0) {
      throw new ConflictException({
        code: 'ROUND_PAID_OUT',
        message: 'Un tour déjà décaissé ne peut pas être annulé.',
      });
    }

    const escrow = await this.prisma.escrow_accounts.findUnique({
      where: { group_id: round.group_id },
    });
    if (!escrow) {
      throw new BadRequestException({
        code: 'ESCROW_NOT_FOUND',
        message: 'Compte séquestre introuvable.',
      });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const contribution of round.contributions) {
        const payment = contribution.payments[0];
        const base = Number(contribution.amount);
        const penalty = Number(contribution.penalty_amount);

        if (base > 0) {
          await this.ledger.refundContribution(tx, {
            escrowAccountId: escrow.id,
            roundId: round.id,
            amount: BigInt(base),
            referenceTable: 'contributions',
            referenceId: contribution.id,
            description: `Annulation tour ${round.round_number} : remboursement cotisation`,
          });
        }
        if (penalty > 0) {
          await this.ledger.recordAdjustment(
            tx,
            {
              escrowAccountId: escrow.id,
              roundId: round.id,
              amount: BigInt(penalty),
              referenceTable: 'contributions',
              referenceId: contribution.id,
              description: `Annulation tour ${round.round_number} : restitution pénalité`,
            },
            'debit',
          );
        }

        await tx.contributions.update({
          where: { id: contribution.id },
          data: { status: 'refunded', penalty_amount: 0n },
        });
        if (payment) {
          await tx.payments.update({
            where: { id: payment.id },
            data: {
              status: 'refunded',
              failure_reason: `Remboursement après annulation du tour : ${input.reason}`,
            },
          });
        }
      }

      await tx.escrow_accounts.update({
        where: { id: escrow.id },
        data: {
          balance_cached: {
            decrement: BigInt(
              round.contributions.reduce((sum, item) => sum + Number(item.amount), 0),
            ),
          },
          guarantee_balance: {
            decrement: BigInt(
              round.contributions.reduce((sum, item) => sum + Number(item.penalty_amount), 0),
            ),
          },
          updated_at: now,
        },
      });

      await tx.payouts.updateMany({
        where: {
          round_id: round.id,
          status: { in: ['pending_approval', 'approved', 'processing'] },
        },
        data: { status: 'cancelled', failure_reason: 'Tour annulé par l’administration.' },
      });

      await tx.rounds.update({
        where: { id: round.id },
        data: { status: 'cancelled', collected_amount: 0n, closed_at: now },
      });
    });

    for (const contribution of round.contributions) {
      try {
        await this.notifications.notify({
          userId: contribution.group_members.user_id,
          template: 'round_cancelled',
          payload: {
            group_name: round.groups.name,
            round_number: round.round_number,
            amount: Number(contribution.amount) + Number(contribution.penalty_amount),
            reason: input.reason,
          },
          dedupeKey: `round-cancelled:${round.id}:${contribution.id}`,
          sms: false,
        });
      } catch {
        // Notification best-effort.
      }
    }

    await this.audit.record({
      actorId,
      action: 'round.cancel',
      entity: 'rounds',
      entityId: round.id,
      metadata: {
        group_id: round.group_id,
        reason: input.reason,
        refunded_contributions: round.contributions.length,
      },
    });

    return {
      id: round.id,
      status: 'cancelled',
      refunded_contributions: round.contributions.length,
      refunded_amount: round.contributions.reduce(
        (sum, item) => sum + Number(item.amount) + Number(item.penalty_amount),
        0,
      ),
    };
  }
}
