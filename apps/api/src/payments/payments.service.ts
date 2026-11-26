import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { isPlatformAdmin, type Actor } from '../groups/permissions';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';
import { idempotencyKeySchema, type PayContributionInput } from './payments.schemas';
import { buildReceiptPdf } from './receipt-pdf';

const PAYABLE_CONTRIBUTION_STATUSES = ['pending', 'late'];
const PAYABLE_ROUND_STATUSES = ['open', 'collecting'];

interface PaymentRow {
  id: string;
  contribution_id: string;
  amount: bigint;
  provider_fee: bigint;
  method: string | null;
  status: string;
  receipt_number: string | null;
  provider: string;
  provider_reference: string | null;
  payer_number: string | null;
  failure_reason: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private serializePayment(payment: PaymentRow) {
    return {
      id: payment.id,
      contribution_id: payment.contribution_id,
      amount: Number(payment.amount),
      provider_fee: Number(payment.provider_fee),
      method: payment.method,
      status: payment.status,
      receipt_number: payment.receipt_number,
      provider: payment.provider,
      provider_reference: payment.provider_reference,
      payer_number: payment.payer_number,
      failure_reason: payment.failure_reason,
      created_at: payment.created_at.toISOString(),
      confirmed_at: payment.confirmed_at ? payment.confirmed_at.toISOString() : null,
    };
  }

  private receiptNumber(paymentId: string): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `REC-${date}-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  private notFoundPayment(): never {
    throw new NotFoundException({
      code: 'PAYMENT_NOT_FOUND',
      message: 'Paiement introuvable.',
    });
  }

  private async canManagePayment(actor: Actor, groupId: string, ownerId: string): Promise<boolean> {
    if (actor.id === ownerId || isPlatformAdmin(actor)) return true;
    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: actor.id } },
      select: { role: true, status: true },
    });
    return (
      membership?.status === 'active' &&
      (membership.role === 'president' || membership.role === 'treasurer')
    );
  }

  // ---------- Paiement d'une cotisation ----------

  async payContribution(
    actor: Actor,
    contributionId: string,
    rawIdempotencyKey: string | undefined,
    input: PayContributionInput,
  ) {
    const parsedKey = idempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedKey.success) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Le header Idempotency-Key est obligatoire (8 à 80 caractères).',
      });
    }
    const idempotencyKey = parsedKey.data;

    const contribution = await this.prisma.contributions.findUnique({
      where: { id: contributionId },
      include: {
        group_members: {
          include: {
            users_group_members_user_idTousers: { select: { full_name: true } },
          },
        },
        rounds: { include: { groups: true } },
      },
    });

    if (!contribution) {
      throw new NotFoundException({
        code: 'CONTRIBUTION_NOT_FOUND',
        message: 'Cotisation introuvable.',
      });
    }

    const member = contribution.group_members;
    const round = contribution.rounds;
    const group = round.groups;

    if (member.user_id !== actor.id) {
      throw new ForbiddenException({
        code: 'NOT_CONTRIBUTION_OWNER',
        message: 'Vous ne pouvez payer que votre propre cotisation.',
      });
    }
    if (member.status !== 'active') {
      throw new ForbiddenException({
        code: 'MEMBER_INACTIVE',
        message: 'Votre adhésion n’est pas active dans ce groupe.',
      });
    }
    if (!group.launched_at) {
      throw new ConflictException({
        code: 'GROUP_NOT_LAUNCHED',
        message: 'Le groupe n’est pas encore lancé.',
      });
    }
    if (!member.rules_accepted_at) {
      throw new UnprocessableEntityException({
        code: 'RULES_NOT_ACCEPTED',
        message: 'Vous devez accepter le règlement du groupe avant de payer.',
      });
    }
    if (!PAYABLE_ROUND_STATUSES.includes(round.status)) {
      throw new ConflictException({
        code: 'ROUND_NOT_OPEN',
        message: 'Ce tour n’est pas ouvert aux paiements.',
      });
    }
    if (!PAYABLE_CONTRIBUTION_STATUSES.includes(contribution.status)) {
      throw new ConflictException({
        code: 'ALREADY_PAID',
        message: 'Cette cotisation a déjà été réglée ou n’est plus payable.',
      });
    }

    const amount = Number(contribution.amount) + Number(contribution.penalty_amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Le montant de la cotisation est invalide.',
      });
    }

    // Anti-double-clic : verrou par cotisation, puis contrôle des paiements en cours.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contributionId}))`;

      const existing = await tx.payments.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        if (existing.contribution_id !== contributionId || existing.user_id !== actor.id) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_CONFLICT',
            message: 'Cette clé d’idempotence a déjà servi pour un autre paiement.',
          });
        }
        return { payment: existing, reused: true };
      }

      const pending = await tx.payments.findFirst({
        where: { contribution_id: contributionId, status: { in: ['initiated', 'pending'] } },
        select: { id: true },
      });
      if (pending) {
        throw new ConflictException({
          code: 'PAYMENT_IN_PROGRESS',
          message: 'Un paiement est déjà en cours pour cette cotisation. Patientez ou relancez-le.',
        });
      }

      const providerReference = `${this.provider.name.toUpperCase()}-${randomUUID()}`;
      const payment = await tx.payments.create({
        data: {
          contribution_id: contributionId,
          user_id: actor.id,
          provider: this.provider.name,
          provider_reference: providerReference,
          method: input.method,
          payer_number: input.payer_number,
          amount: BigInt(amount),
          status: 'initiated',
          idempotency_key: idempotencyKey,
        },
      });

      return { payment, reused: false };
    });

    if (created.reused) {
      return { ...this.serializePayment(created.payment), reused: true };
    }

    try {
      const result = await this.provider.collect({
        paymentId: created.payment.id,
        providerReference:
          created.payment.provider_reference ??
          `${this.provider.name.toUpperCase()}-${randomUUID()}`,
        amount,
        method: input.method,
        payerNumber: input.payer_number,
        idempotencyKey,
      });

      const updated = await this.prisma.payments.update({
        where: { id: created.payment.id },
        data: {
          status: result.status,
          provider_reference: result.providerReference,
          provider_fee: BigInt(result.providerFee ?? 0),
          failure_reason: result.failureReason ?? null,
        },
      });

      return { ...this.serializePayment(updated), reused: false };
    } catch (error) {
      this.logger.error(
        `Échec de collecte du paiement ${created.payment.id} : ${(error as Error).message}`,
      );
      await this.prisma.payments.update({
        where: { id: created.payment.id },
        data: {
          status: 'failed',
          failure_reason: 'Agrégateur de paiement indisponible. Réessayez.',
        },
      });
      throw new BadGatewayException({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE',
        message: 'Le service de paiement est momentanément indisponible. Réessayez.',
      });
    }
  }

  // ---------- Consultation ----------

  async getPayment(actor: Actor, paymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { id: paymentId },
      include: {
        contributions: {
          include: {
            group_members: {
              include: { users_group_members_user_idTousers: { select: { full_name: true } } },
            },
            rounds: { include: { groups: true } },
          },
        },
      },
    });
    if (!payment) this.notFoundPayment();

    const group = payment.contributions.rounds.groups;
    if (!(await this.canManagePayment(actor, group.id, payment.user_id))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Vous n’avez pas accès à ce paiement.',
      });
    }

    return {
      ...this.serializePayment(payment),
      contribution: {
        id: payment.contributions.id,
        amount: Number(payment.contributions.amount),
        penalty_amount: Number(payment.contributions.penalty_amount),
        status: payment.contributions.status,
      },
      member: {
        full_name: payment.contributions.group_members.users_group_members_user_idTousers.full_name,
      },
      group: { id: group.id, name: group.name },
      round_number: payment.contributions.rounds.round_number,
    };
  }

  async listMyPayments(actor: Actor) {
    const payments = await this.prisma.payments.findMany({
      where: { user_id: actor.id },
      include: {
        contributions: {
          include: { rounds: { include: { groups: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return payments.map((payment) => ({
      ...this.serializePayment(payment),
      group: {
        id: payment.contributions.rounds.groups.id,
        name: payment.contributions.rounds.groups.name,
      },
      round_number: payment.contributions.rounds.round_number,
    }));
  }

  async getReceipt(actor: Actor, paymentId: string) {
    const payment = await this.prisma.payments.findUnique({
      where: { id: paymentId },
      include: {
        users: { select: { full_name: true, phone: true } },
        contributions: {
          include: {
            rounds: { include: { groups: true } },
          },
        },
      },
    });
    if (!payment) this.notFoundPayment();

    const group = payment.contributions.rounds.groups;
    if (!(await this.canManagePayment(actor, group.id, payment.user_id))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Vous n’avez pas accès à ce reçu.',
      });
    }
    if (payment.status !== 'confirmed' || !payment.receipt_number) {
      throw new ConflictException({
        code: 'RECEIPT_NOT_AVAILABLE',
        message: 'Le reçu sera disponible dès la confirmation du paiement.',
      });
    }

    const pdf = buildReceiptPdf({
      receiptNumber: payment.receipt_number,
      paidAt: payment.confirmed_at ?? payment.created_at,
      payerName: payment.users.full_name,
      payerPhone: payment.users.phone,
      groupName: group.name,
      roundNumber: payment.contributions.rounds.round_number,
      amount: Number(payment.contributions.amount),
      penalty: Math.max(0, Number(payment.amount) - Number(payment.contributions.amount)),
      method: payment.method ?? '—',
      providerReference: payment.provider_reference ?? '—',
    });

    return {
      filename: `${payment.receipt_number}.pdf`,
      buffer: pdf,
    };
  }

  // ---------- Webhook ----------

  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (providerName !== this.provider.name) {
      throw new NotFoundException({
        code: 'PROVIDER_NOT_FOUND',
        message: 'Fournisseur de paiement inconnu.',
      });
    }

    const event = this.provider.parseWebhook(rawBody, signature);
    if (!event) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Signature du webhook invalide.',
      });
    }

    let confirmation: {
      userId: string;
      paymentId: string;
      groupName: string;
      roundNumber: number;
    } | null = null;

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const recorded = await tx.webhook_events.create({
            data: {
              provider: providerName,
              event_id: event.eventId,
              payload: event as unknown as Prisma.InputJsonValue,
              signature_ok: true,
            },
          });

          const processed = async (result: Record<string, unknown>) => {
            await tx.webhook_events.update({
              where: { id: recorded.id },
              data: { processed_at: new Date() },
            });
            return result;
          };

          const payment = await tx.payments.findUnique({
            where: { provider_reference: event.providerReference },
          });
          if (!payment) {
            // Ne bloque pas un webhook arrivé avant l'enregistrement de la référence :
            // il est acquitté et pourra être renvoyé par l'agrégateur.
            this.logger.warn(`Webhook ${event.eventId} : paiement inconnu.`);
            return processed({ received: true, ignored: 'PAYMENT_NOT_FOUND' });
          }

          if (payment.status === 'confirmed') {
            return processed({ received: true, ignored: 'ALREADY_CONFIRMED' });
          }
          if (payment.status === 'refunded') {
            return processed({ received: true, ignored: 'PAYMENT_REFUNDED' });
          }

          if (payment.amount !== BigInt(event.amount)) {
            throw new BadRequestException({
              code: 'WEBHOOK_AMOUNT_MISMATCH',
              message: 'Le montant du webhook ne correspond pas au paiement.',
            });
          }

          if (event.status === 'failed') {
            // Un échec tardif ne doit jamais écraser une confirmation déjà enregistrée.
            await tx.payments.updateMany({
              where: { id: payment.id, status: { notIn: ['confirmed', 'refunded'] } },
              data: {
                status: 'failed',
                failure_reason: event.reason ?? 'Paiement refusé par l’agrégateur.',
                raw_webhook: event as unknown as Prisma.InputJsonValue,
              },
            });
            return processed({ received: true, payment_status: 'failed' });
          }

          const contributionRef = await tx.contributions.findUnique({
            where: { id: payment.contribution_id },
            select: { round_id: true },
          });
          if (!contributionRef) {
            return processed({ received: true, ignored: 'CONTRIBUTION_NOT_FOUND' });
          }

          // Verrou par cotisation, pas par tour : deux cotisations différentes
          // peuvent se confirmer en parallèle. Un double webhook sur la même
          // cotisation reste sérialisé, puis relu après le verrou.
          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${payment.contribution_id}::text))
        `;

          const lockedPayment = await tx.payments.findUnique({ where: { id: payment.id } });
          if (!lockedPayment) {
            return processed({ received: true, ignored: 'PAYMENT_NOT_FOUND' });
          }
          if (lockedPayment.status === 'confirmed') {
            return processed({ received: true, ignored: 'ALREADY_CONFIRMED' });
          }
          if (lockedPayment.status === 'refunded') {
            return processed({ received: true, ignored: 'PAYMENT_REFUNDED' });
          }

          const contribution = await tx.contributions.findUnique({
            where: { id: payment.contribution_id },
            include: { rounds: { include: { groups: true } } },
          });
          if (!contribution) {
            return processed({ received: true, ignored: 'CONTRIBUTION_NOT_FOUND' });
          }

          if (contribution.status === 'paid') {
            await tx.payments.update({
              where: { id: payment.id },
              data: {
                status: 'failed',
                failure_reason: 'Cotisation déjà réglée par un autre paiement.',
                raw_webhook: event as unknown as Prisma.InputJsonValue,
              },
            });
            return processed({ received: true, ignored: 'CONTRIBUTION_ALREADY_PAID' });
          }

          const baseAmount = Number(contribution.amount);
          const penaltyAmount = event.amount - baseAmount;
          if (penaltyAmount < 0) {
            throw new BadRequestException({
              code: 'WEBHOOK_AMOUNT_MISMATCH',
              message: 'Le montant est inférieur à la cotisation due.',
            });
          }

          const now = new Date();
          const receiptNumber = this.receiptNumber(payment.id);

          await tx.payments.update({
            where: { id: payment.id },
            data: {
              status: 'confirmed',
              confirmed_at: now,
              receipt_number: receiptNumber,
              raw_webhook: event as unknown as Prisma.InputJsonValue,
            },
          });

          await tx.contributions.update({
            where: { id: contribution.id },
            data: { status: 'paid', paid_at: now },
          });

          const escrow = await tx.escrow_accounts.upsert({
            where: { group_id: contribution.rounds.group_id },
            // Les pénalités ne restent pas dans le solde séquestre : elles sont
            // reversées à la caisse de garantie (invariant : ledger = cache + garantie).
            create: {
              group_id: contribution.rounds.group_id,
              currency: 'XAF',
              balance_cached: BigInt(baseAmount),
              guarantee_balance: BigInt(penaltyAmount),
            },
            update: {
              balance_cached: { increment: BigInt(baseAmount) },
              guarantee_balance: { increment: BigInt(penaltyAmount) },
              updated_at: now,
            },
          });

          await this.ledger.creditContribution(tx, {
            escrowAccountId: escrow.id,
            roundId: contribution.round_id,
            amount: BigInt(baseAmount),
            referenceTable: 'payments',
            referenceId: payment.id,
            description: `Cotisation tour ${contribution.rounds.round_number}`,
          });

          if (penaltyAmount > 0) {
            await this.ledger.creditPenalty(tx, {
              escrowAccountId: escrow.id,
              roundId: contribution.round_id,
              amount: BigInt(penaltyAmount),
              referenceTable: 'payments',
              referenceId: payment.id,
              description: `Pénalité de retard tour ${contribution.rounds.round_number}`,
            });
          }

          const updatedRound = await tx.rounds.update({
            where: { id: contribution.round_id },
            data: {
              collected_amount: { increment: BigInt(baseAmount) },
              ...(contribution.rounds.status === 'open' ? { status: 'collecting' as const } : {}),
            },
          });

          if (
            Number(updatedRound.collected_amount) >= Number(updatedRound.expected_amount) &&
            (updatedRound.status === 'open' || updatedRound.status === 'collecting')
          ) {
            await tx.rounds.update({
              where: { id: updatedRound.id },
              data: { status: 'ready' },
            });
          }

          confirmation = {
            userId: payment.user_id,
            paymentId: payment.id,
            groupName: contribution.rounds.groups.name,
            roundNumber: contribution.rounds.round_number,
          };

          return processed({
            received: true,
            payment_status: 'confirmed',
            receipt_number: receiptNumber,
          });
        },
        { maxWait: 10_000, timeout: 20_000 },
      );

      const outcome = result as { payment_status?: string };
      const confirmed = confirmation as {
        userId: string;
        paymentId: string;
        groupName: string;
        roundNumber: number;
      } | null;
      if (outcome.payment_status === 'confirmed' && confirmed) {
        await this.audit.record({
          actorId: confirmed.userId,
          action: 'payment.confirm',
          entity: 'payments',
          entityId: confirmed.paymentId,
          metadata: { amount: event.amount, provider: providerName },
        });
        this.provider.notifySettled?.({
          direction: 'in',
          providerReference: event.providerReference,
          amount: event.amount,
        });
        // Notifier ne doit pas rallonger la confirmation : le webhook répond
        // dès que l'écriture financière est commitée, l'envoi est best-effort.
        void this.notifications
          .notify({
            userId: confirmed.userId,
            template: 'payment_received',
            payload: {
              amount: event.amount,
              group_name: confirmed.groupName,
              round_number: confirmed.roundNumber,
            },
            dedupeKey: `payment:${confirmed.paymentId}`,
          })
          .catch((notificationError: unknown) => {
            this.logger.warn(
              `Notification de paiement non envoyée : ${(notificationError as Error).message}`,
            );
          });
      }

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }
}
