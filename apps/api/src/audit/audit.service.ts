import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditContext } from './audit-context';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Journal d'audit des actions sensibles (règle 13) : acteur, action, entité et IP.
 * Une panne d'audit ne doit jamais annuler l'action métier déjà commitée.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const context = auditContext.getStore();
    try {
      await this.prisma.audit_logs.create({
        data: {
          actor_id: input.actorId ?? null,
          action: input.action,
          entity: input.entity,
          entity_id: input.entityId ?? null,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          ip: context?.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit non enregistré (${input.action}) : ${(error as Error).message}`);
    }
  }

  async list(filters: {
    actor_id?: string;
    action?: string;
    entity?: string;
    entity_id?: string;
    from?: string;
    to?: string;
    page: number;
    page_size: number;
  }) {
    const where: Prisma.audit_logsWhereInput = {
      ...(filters.actor_id ? { actor_id: filters.actor_id } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entity ? { entity: filters.entity } : {}),
      ...(filters.entity_id ? { entity_id: filters.entity_id } : {}),
      ...(filters.from || filters.to
        ? {
            created_at: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.audit_logs.count({ where }),
      this.prisma.audit_logs.findMany({
        where,
        include: { users: { select: { full_name: true, phone: true } } },
        orderBy: { created_at: 'desc' },
        skip: (filters.page - 1) * filters.page_size,
        take: filters.page_size,
      }),
    ]);

    return {
      total,
      page: filters.page,
      page_size: filters.page_size,
      items: rows.map((row) => ({
        id: row.id.toString(),
        actor_id: row.actor_id,
        actor_name: row.users?.full_name ?? null,
        actor_phone: row.users?.phone ?? null,
        action: row.action,
        entity: row.entity,
        entity_id: row.entity_id,
        metadata: row.metadata,
        ip: row.ip,
        created_at: row.created_at.toISOString(),
      })),
    };
  }
}
