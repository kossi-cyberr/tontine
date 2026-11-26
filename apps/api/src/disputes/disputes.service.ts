import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../groups/permissions';
import type { CreateDisputeInput, ListDisputesQuery, UpdateDisputeInput } from './disputes.schemas';

const STATUS_LABELS: Record<string, string> = {
  open: 'ouvert',
  in_review: 'en cours d’examen',
  resolved: 'résolu',
  rejected: 'rejeté',
};

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private serialize(row: {
    id: string;
    group_id: string;
    round_id: string | null;
    payment_id: string | null;
    opened_by: string;
    subject: string;
    description: string;
    attachments: Prisma.JsonValue;
    status: string;
    resolution: string | null;
    resolved_by: string | null;
    created_at: Date;
    resolved_at: Date | null;
    groups?: { name: string } | null;
    users_disputes_opened_byTousers?: { full_name: string; phone: string } | null;
    users_disputes_resolved_byTousers?: { full_name: string } | null;
  }) {
    return {
      id: row.id,
      group_id: row.group_id,
      group_name: row.groups?.name ?? null,
      round_id: row.round_id,
      payment_id: row.payment_id,
      opened_by: row.opened_by,
      opened_by_name: row.users_disputes_opened_byTousers?.full_name ?? null,
      opener_phone: row.users_disputes_opened_byTousers?.phone ?? null,
      subject: row.subject,
      description: row.description,
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      status: row.status,
      resolution: row.resolution,
      resolved_by: row.resolved_by,
      resolved_by_name: row.users_disputes_resolved_byTousers?.full_name ?? null,
      created_at: row.created_at.toISOString(),
      resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
    };
  }

  async list(actor: Actor, query: ListDisputesQuery) {
    let scope: Prisma.disputesWhereInput = {};
    if (actor.platform_role !== 'super_admin') {
      const memberships = await this.prisma.group_members.findMany({
        where: { user_id: actor.id, status: 'active' },
        select: { group_id: true },
      });
      scope = {
        OR: [
          { opened_by: actor.id },
          { group_id: { in: memberships.map((membership) => membership.group_id) } },
        ],
      };
    }

    const where: Prisma.disputesWhereInput = {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.disputes.count({ where }),
      this.prisma.disputes.findMany({
        where,
        include: {
          groups: { select: { name: true } },
          users_disputes_opened_byTousers: { select: { full_name: true, phone: true } },
          users_disputes_resolved_byTousers: { select: { full_name: true } },
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
      items: rows.map((row) => this.serialize(row)),
    };
  }

  async create(actor: Actor, input: CreateDisputeInput) {
    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: input.group_id, user_id: actor.id } },
      select: { status: true },
    });
    if (actor.platform_role !== 'super_admin' && membership?.status !== 'active') {
      throw new ForbiddenException({
        code: 'NOT_A_MEMBER',
        message: 'Vous ne faites pas partie de ce groupe.',
      });
    }

    if (input.round_id) {
      const round = await this.prisma.rounds.findUnique({
        where: { id: input.round_id },
        select: { group_id: true },
      });
      if (!round || round.group_id !== input.group_id) {
        throw new BadRequestException({
          code: 'INVALID_ROUND',
          message: 'Ce tour n’appartient pas au groupe.',
        });
      }
    }

    if (input.payment_id) {
      const payment = await this.prisma.payments.findUnique({
        where: { id: input.payment_id },
        select: { contributions: { select: { rounds: { select: { group_id: true } } } } },
      });
      if (!payment || payment.contributions.rounds.group_id !== input.group_id) {
        throw new BadRequestException({
          code: 'INVALID_PAYMENT',
          message: 'Ce paiement n’appartient pas au groupe.',
        });
      }
    }

    const dispute = await this.prisma.disputes.create({
      data: {
        group_id: input.group_id,
        round_id: input.round_id ?? null,
        payment_id: input.payment_id ?? null,
        opened_by: actor.id,
        subject: input.subject,
        description: input.description,
        attachments: input.attachments as Prisma.InputJsonValue,
        status: 'open',
      },
      include: { groups: { select: { name: true } } },
    });

    await this.audit.record({
      actorId: actor.id,
      action: 'dispute.open',
      entity: 'disputes',
      entityId: dispute.id,
      metadata: { group_id: input.group_id, round_id: input.round_id ?? null },
    });

    const admins = await this.prisma.users.findMany({
      where: { platform_role: 'super_admin', status: 'active' },
      select: { id: true },
    });
    for (const admin of admins) {
      try {
        await this.notifications.notify({
          userId: admin.id,
          template: 'dispute_opened',
          payload: {
            group_name: dispute.groups.name,
            subject: dispute.subject,
          },
          dedupeKey: `dispute-opened:${dispute.id}:${admin.id}`,
          sms: false,
        });
      } catch {
        // Notification best-effort.
      }
    }

    return this.serialize(dispute);
  }

  async update(actor: Actor, disputeId: string, input: UpdateDisputeInput) {
    if (actor.platform_role !== 'super_admin') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Seul un Super Admin peut traiter un litige.',
      });
    }

    const dispute = await this.prisma.disputes.findUnique({
      where: { id: disputeId },
      include: { groups: { select: { name: true } } },
    });
    if (!dispute) {
      throw new NotFoundException({ code: 'DISPUTE_NOT_FOUND', message: 'Litige introuvable.' });
    }
    if (['resolved', 'rejected'].includes(dispute.status)) {
      throw new ConflictException({
        code: 'DISPUTE_CLOSED',
        message: 'Ce litige est déjà clôturé.',
      });
    }

    const final = ['resolved', 'rejected'].includes(input.status);
    const updated = await this.prisma.disputes.update({
      where: { id: disputeId },
      data: {
        status: input.status,
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        ...(final ? { resolved_by: actor.id, resolved_at: new Date() } : {}),
      },
      include: { groups: { select: { name: true } } },
    });

    await this.audit.record({
      actorId: actor.id,
      action: `dispute.${input.status}`,
      entity: 'disputes',
      entityId: disputeId,
      metadata: { resolution: input.resolution ?? null },
    });

    try {
      await this.notifications.notify({
        userId: dispute.opened_by,
        template: 'dispute_decided',
        payload: {
          group_name: dispute.groups.name,
          subject: dispute.subject,
          status_label: STATUS_LABELS[input.status] ?? input.status,
          resolution: input.resolution ?? 'en cours d’examen',
        },
        dedupeKey: `dispute:${disputeId}:${input.status}:${Date.now()}`,
      });
    } catch {
      // Notification best-effort.
    }

    return this.serialize(updated);
  }
}
