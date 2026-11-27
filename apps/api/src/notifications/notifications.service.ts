import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms.provider';

export type NotificationTemplate =
  | 'payment_received'
  | 'payout_success'
  | 'contribution_late'
  | 'round_opened'
  | 'reminder_j3'
  | 'reminder_j1'
  | 'reminder_j'
  | 'reminder_j1_late'
  | 'reminder_manual'
  | 'kyc_verified'
  | 'kyc_rejected'
  | 'dispute_opened'
  | 'dispute_decided'
  | 'member_replaced'
  | 'round_cancelled'
  | 'cycle_closed'
  | 'cycle_opened';

type PayloadValue = string | number | null | undefined;
export type NotificationPayload = Record<string, PayloadValue>;

interface NotifyInput {
  userId: string;
  template: NotificationTemplate;
  payload: NotificationPayload;
  /** Clé d'unicité : un même événement n'est jamais notifié deux fois. */
  dedupeKey?: string;
  /** Envoi SMS en plus de la notification in-app (activé par défaut). */
  sms?: boolean;
}

export interface RenderedNotification {
  title: string;
  message: string;
}

function formatXaf(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(amount)} XAF`;
}

/** Gabarits français centralisés : un seul endroit pour les textes. */
export function renderNotification(
  template: NotificationTemplate,
  payload: NotificationPayload,
): RenderedNotification {
  const group = String(payload.group_name ?? 'votre groupe');
  const round = payload.round_number ? `tour ${payload.round_number}` : 'tour en cours';
  const amount = Number(payload.amount ?? 0);

  switch (template) {
    case 'payment_received':
      return {
        title: 'Paiement confirmé',
        message: `Votre cotisation de ${formatXaf(amount)} pour ${group} (${round}) est confirmée. Reçu disponible dans l'application.`,
      };
    case 'payout_success':
      return {
        title: 'Décaissement effectué',
        message: `Le décaissement de ${formatXaf(amount)} pour ${group} (${round}) a été versé sur votre compte. Justificatif disponible dans l'application.`,
      };
    case 'contribution_late':
      return {
        title: 'Cotisation en retard',
        message: `Votre cotisation pour ${group} (${round}) est en retard. Pénalité appliquée : ${formatXaf(amount)}. Régularisez dès que possible.`,
      };
    case 'round_opened':
      return {
        title: 'Nouveau tour ouvert',
        message: `${group} : le ${round} est ouvert. Cotisation attendue : ${formatXaf(amount)}.`,
      };
    case 'reminder_j3':
    case 'reminder_j1':
    case 'reminder_j': {
      const when =
        template === 'reminder_j3'
          ? 'dans 3 jours'
          : template === 'reminder_j1'
            ? 'demain'
            : "aujourd'hui";
      return {
        title: 'Rappel de cotisation',
        message: `${group} : votre cotisation de ${formatXaf(amount)} pour le ${round} est due ${when}.`,
      };
    }
    case 'reminder_j1_late':
      return {
        title: 'Cotisation en retard',
        message: `${group} : votre cotisation de ${formatXaf(amount)} pour le ${round} est échue depuis hier. Merci de régulariser.`,
      };
    case 'reminder_manual':
      return {
        title: 'Relance du président',
        message: `${group} : le président vous rappelle que votre cotisation de ${formatXaf(amount)} pour le ${round} est attendue.`,
      };
    case 'kyc_verified':
      return {
        title: 'Dossier KYC validé',
        message: 'Votre pièce d’identité a été vérifiée. Vous pouvez recevoir vos décaissements.',
      };
    case 'kyc_rejected':
      return {
        title: 'Dossier KYC rejeté',
        message: `Votre dossier KYC a été rejeté. Motif : ${String(payload.reason ?? 'non précisé')}. Vous pouvez soumettre une nouvelle pièce.`,
      };
    case 'dispute_opened':
      return {
        title: 'Nouveau litige',
        message: `${group} : un litige « ${String(payload.subject ?? '')} » a été ouvert et attend une décision.`,
      };
    case 'dispute_decided':
      return {
        title: 'Litige traité',
        message: `Votre litige « ${String(payload.subject ?? '')} » est ${String(payload.status_label ?? 'traité')}. Décision : ${String(payload.resolution ?? '')}`,
      };
    case 'member_replaced':
      return {
        title: 'Changement de membre',
        message: `${group} : ${String(payload.message ?? 'un membre a été remplacé.')}`,
      };
    case 'round_cancelled':
      return {
        title: 'Tour annulé',
        message: `${group} : le ${round} est annulé. Motif : ${String(payload.reason ?? 'non précisé')}. Remboursement de ${formatXaf(amount)} enregistré.`,
      };
    case 'cycle_closed':
      return {
        title: 'Cycle terminé',
        message: `${group} : le cycle ${String(payload.cycle_number ?? '')} est clôturé. Merci à tous les membres.`,
      };
    case 'cycle_opened':
      return {
        title: 'Nouveau cycle',
        message: `${group} : le cycle ${String(payload.cycle_number ?? '')} démarre. Cotisation attendue : ${formatXaf(amount)}.`,
      };
  }
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private async alreadySent(userId: string, dedupeKey: string): Promise<boolean> {
    const existing = await this.prisma.notifications.findFirst({
      where: {
        user_id: userId,
        payload: { path: ['dedupe_key'], equals: dedupeKey },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  /**
   * Crée une notification in-app et, par défaut, envoie un SMS.
   * Un échec SMS est journalisé et marqué `failed`, sans faire échouer l'appelant.
   */
  async notify(input: NotifyInput) {
    if (input.dedupeKey && (await this.alreadySent(input.userId, input.dedupeKey))) {
      return { skipped: true as const, sent: false };
    }

    const rendered = renderNotification(input.template, input.payload);
    const basePayload = {
      ...input.payload,
      title: rendered.title,
      message: rendered.message,
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
    } as Prisma.InputJsonValue;

    const inApp = await this.prisma.notifications.create({
      data: {
        user_id: input.userId,
        channel: 'in_app',
        template: input.template,
        payload: basePayload,
        status: 'sent',
        sent_at: new Date(),
      },
    });

    if (input.sms === false) return { skipped: false as const, sent: true, in_app: inApp };

    const user = await this.prisma.users.findUnique({
      where: { id: input.userId },
      select: { phone: true },
    });
    if (!user) return { skipped: false as const, sent: true, in_app: inApp };

    const row = await this.prisma.notifications.create({
      data: {
        user_id: input.userId,
        channel: 'sms',
        template: input.template,
        payload: basePayload,
        status: 'queued',
      },
    });

    try {
      await this.sms.send(user.phone, `Tontine : ${rendered.message}`);
      await this.prisma.notifications.update({
        where: { id: row.id },
        data: { status: 'sent', sent_at: new Date() },
      });
    } catch (error) {
      this.logger.warn(
        `SMS ${input.template} non envoyé (${input.userId}) : ${(error as Error).message}`,
      );
      await this.prisma.notifications.update({
        where: { id: row.id },
        data: { status: 'failed' },
      });
    }

    return { skipped: false as const, sent: true, in_app: inApp };
  }

  async list(userId: string, page = 1, pageSize = 30) {
    const rows = await this.prisma.notifications.findMany({
      where: { user_id: userId, channel: 'in_app' },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return rows.map((row) => this.serialize(row));
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notifications.count({
      where: { user_id: userId, channel: 'in_app', read_at: null },
    });
    return { unread: count };
  }

  async markRead(userId: string, notificationId: string) {
    const row = await this.prisma.notifications.findFirst({
      where: { id: notificationId, user_id: userId, channel: 'in_app' },
      select: { id: true, read_at: true },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification introuvable.',
      });
    }
    if (row.read_at) return { read: true };

    await this.prisma.notifications.update({
      where: { id: row.id },
      data: { read_at: new Date(), status: 'read' },
    });
    return { read: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notifications.updateMany({
      where: { user_id: userId, channel: 'in_app', read_at: null },
      data: { read_at: new Date(), status: 'read' },
    });
    return { updated: result.count };
  }

  private serialize(row: {
    id: string;
    template: string;
    payload: Prisma.JsonValue;
    status: string;
    read_at: Date | null;
    created_at: Date;
  }) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      template: row.template,
      title: typeof payload.title === 'string' ? payload.title : 'Notification',
      message: typeof payload.message === 'string' ? payload.message : '',
      read: row.read_at !== null,
      status: row.status,
      created_at: row.created_at.toISOString(),
    };
  }
}
