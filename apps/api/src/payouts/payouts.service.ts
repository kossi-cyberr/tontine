import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { OtpService } from '../auth/otp.service';
import { isPlatformAdmin, type Actor } from '../groups/permissions';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/payment-provider';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, type SmsProvider } from '../sms/sms.provider';
import { buildPayoutReceiptPdf } from './payout-receipt';
import {
  computePayoutAmounts,
  isEligibleForPayout,
  PAYOUT_ACCOUNT_DELAY_MS,
  type PayoutEligibility,
} from './payout-rules';
import type { RequestPayoutInput } from './payouts.schemas';

const ACTIVE_PAYOUT_STATUSES = ['pending_approval', 'approved', 'processing', 'success'];
const MANAGER_ROLES = ['president', 'treasurer'];
const MAX_ATTEMPTS = 3;

const payoutInclude = {
  group_members: {
    include: {
      users_group_members_user_idTousers: {
        select: { id: true, full_name: true, phone: true },
      },
    },
  },
  payout_accounts: true,
  rounds: { include: { groups: true } },
} satisfies Prisma.payoutsInclude;

type PayoutWithRelations = Prisma.payoutsGetPayload<{ include: typeof payoutInclude }>;

const roundInclude = {
  groups: true,
  group_members: {
    include: {
      users_group_members_user_idTousers: {
        select: { id: true, full_name: true, phone: true, status: true },
      },
    },
  },
  payouts: { orderBy: { created_at: 'desc' } },
} satisfies Prisma.roundsInclude;

type RoundWithRelations = Prisma.roundsGetPayload<{ include: typeof roundInclude }>;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function maskAccount(accountNumber: string): string {
  const visible = accountNumber.replace(/\s/g, '').slice(-4);
  return `•••• ${visible}`;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly otp: OtpService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ---------- Helpers ----------

  private serializePayout(payout: PayoutWithRelations) {
    const beneficiary = payout.group_members.users_group_members_user_idTousers;
    return {
      id: payout.id,
      round_id: payout.round_id,
      round_number: payout.rounds.round_number,
      group: { id: payout.rounds.groups.id, name: payout.rounds.groups.name },
      beneficiary: {
        id: payout.group_members.id,
        user_id: payout.group_members.user_id,
        full_name: beneficiary.full_name,
        phone: beneficiary.phone,
      },
      destination: {
        type: payout.payout_accounts.type,
        account_number: maskAccount(payout.payout_accounts.account_number),
        holder_name: payout.payout_accounts.holder_name,
      },
      gross_amount: Number(payout.gross_amount),
      platform_fee: Number(payout.platform_fee),
      provider_fee: Number(payout.provider_fee),
      net_amount: Number(payout.net_amount),
      status: payout.status,
      attempts: payout.attempts,
      failure_reason: payout.failure_reason,
      requested_by: payout.requested_by,
      approved_by: payout.approved_by,
      second_approved_by: payout.second_approved_by,
      provider_reference: payout.provider_reference,
      idempotency_key: payout.idempotency_key,
      executed_at: payout.executed_at ? payout.executed_at.toISOString() : null,
      created_at: payout.created_at.toISOString(),
    };
  }

  private async loadRound(roundId: string): Promise<RoundWithRelations> {
    const round = await this.prisma.rounds.findUnique({
      where: { id: roundId },
      include: roundInclude,
    });
    if (!round) {
      throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Tour introuvable.' });
    }
    return round;
  }

  private async membership(actor: Actor, groupId: string) {
    return this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: actor.id } },
      select: { id: true, role: true, status: true },
    });
  }

  private async assertManager(actor: Actor, groupId: string): Promise<void> {
    if (isPlatformAdmin(actor)) return;
    const membership = await this.membership(actor, groupId);
    if (!membership || membership.status !== 'active' || !MANAGER_ROLES.includes(membership.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Seul le président ou le trésorier peut gérer le décaissement.',
      });
    }
  }

  private async assertViewer(actor: Actor, groupId: string): Promise<void> {
    if (isPlatformAdmin(actor)) return;
    const membership = await this.membership(actor, groupId);
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenException({
        code: 'NOT_A_MEMBER',
        message: 'Vous ne faites pas partie de ce groupe.',
      });
    }
  }

  private async destinationAccount(userId: string) {
    return this.prisma.payout_accounts.findFirst({
      where: { user_id: userId },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
  }

  private activePayout(round: RoundWithRelations) {
    return round.payouts.find((payout) => ACTIVE_PAYOUT_STATUSES.includes(payout.status)) ?? null;
  }

  private async buildEligibility(round: RoundWithRelations, allowPartial: boolean) {
    const account = await this.destinationAccount(round.group_members.user_id);
    const escrow = await this.prisma.escrow_accounts.findUnique({
      where: { group_id: round.group_id },
    });
    const active = this.activePayout(round);

    const eligibility = isEligibleForPayout({
      round: {
        status: round.status,
        collected_amount: Number(round.collected_amount),
        expected_amount: Number(round.expected_amount),
        payout_date: round.payout_date,
      },
      beneficiaryStatus: round.group_members.status,
      account: account
        ? { verified_at: account.verified_at, active_from: account.active_from }
        : null,
      guaranteeAvailable: Number(escrow?.guarantee_balance ?? 0n),
      hasActivePayout: Boolean(active),
      allowPartial,
      rule: round.groups.payout_rule,
      now: new Date(),
    });

    return { eligibility, account, escrow, activePayout: active };
  }

  private assertEligible(eligibility: PayoutEligibility): void {
    if (eligibility.eligible) return;
    const messages: Record<string, string> = {
      ROUND_NOT_ELIGIBLE: 'Ce tour n’est pas dans un état permettant le décaissement.',
      PAYOUT_ALREADY_ACTIVE: 'Un décaissement est déjà en cours ou réalisé pour ce tour.',
      BENEFICIARY_INACTIVE: 'Le bénéficiaire n’est plus un membre actif du groupe.',
      DESTINATION_ACCOUNT_REQUIRED:
        'Le bénéficiaire doit enregistrer un compte de réception avant le décaissement.',
      DESTINATION_ACCOUNT_UNVERIFIED: 'Le compte de réception du bénéficiaire n’est pas vérifié.',
      DESTINATION_ACCOUNT_TOO_RECENT:
        'Le compte de réception a été modifié il y a moins de 24 heures (délai de sécurité).',
      PAYOUT_DATE_NOT_REACHED: 'La date de décaissement du tour n’est pas encore atteinte.',
      COLLECTION_INCOMPLETE: 'La collecte du tour est incomplète.',
    };
    const reason = eligibility.reasons[0] ?? 'COLLECTION_INCOMPLETE';
    throw new UnprocessableEntityException({
      code: 'PAYOUT_NOT_ELIGIBLE',
      message: messages[reason] ?? 'Les conditions de décaissement ne sont pas remplies.',
      details: {
        reasons: eligibility.reasons,
        collected_amount: eligibility.collected,
        expected_amount: eligibility.expected,
        shortfall: eligibility.shortfall,
      },
    });
  }

  // ---------- Demande et approbation ----------

  async request(actor: Actor, roundId: string, input: RequestPayoutInput) {
    const round = await this.loadRound(roundId);
    await this.assertManager(actor, round.group_id);

    if (!round.groups.launched_at) {
      throw new ConflictException({
        code: 'GROUP_NOT_LAUNCHED',
        message: 'Le groupe n’est pas encore lancé.',
      });
    }
    if (utcDay(new Date()) < utcDay(round.payout_date)) {
      throw new UnprocessableEntityException({
        code: 'PAYOUT_DATE_NOT_REACHED',
        message: 'La date de décaissement du tour n’est pas encore atteinte.',
      });
    }

    const { eligibility, account, activePayout } = await this.buildEligibility(
      round,
      input.allow_partial === true,
    );

    if (activePayout) {
      const full = await this.prisma.payouts.findUniqueOrThrow({
        where: { id: activePayout.id },
        include: payoutInclude,
      });
      return { ...this.serializePayout(full), reused: true };
    }

    const failed = round.payouts.find((payout) => payout.status === 'failed');
    if (failed) {
      throw new ConflictException({
        code: failed.attempts >= MAX_ATTEMPTS ? 'PAYOUT_REQUIRES_REVIEW' : 'PAYOUT_RETRY_SCHEDULED',
        message:
          failed.attempts >= MAX_ATTEMPTS
            ? 'Le décaissement a échoué 3 fois. Un administrateur doit intervenir.'
            : 'Le décaissement a échoué. Une nouvelle tentative est planifiée automatiquement.',
        details: { attempts: failed.attempts, payout_id: failed.id },
      });
    }

    if (!account) {
      // Message métier explicite plutôt qu'un simple « non éligible ».
      throw new UnprocessableEntityException({
        code: 'DESTINATION_ACCOUNT_REQUIRED',
        message: 'Le bénéficiaire doit enregistrer un compte de réception avant le décaissement.',
      });
    }

    this.assertEligible(eligibility);

    const amounts = computePayoutAmounts(
      eligibility.gross_amount,
      round.groups.platform_fee_type,
      Number(round.groups.platform_fee_value),
    );

    // Un gestionnaire seul ne peut pas s'auto-approuver : la demande est alors
    // enregistrée comme demande système (`requested_by = null`).
    let requestedBy: string | null = actor.id;
    if (!isPlatformAdmin(actor)) {
      const otherManagers = await this.prisma.group_members.count({
        where: {
          group_id: round.group_id,
          status: 'active',
          role: { in: ['president', 'treasurer'] },
          user_id: { not: actor.id },
        },
      });
      if (otherManagers === 0) requestedBy = null;
    }

    try {
      const payout = await this.prisma.payouts.create({
        data: {
          round_id: round.id,
          beneficiary_member_id: round.beneficiary_member_id,
          destination_account_id: account.id,
          gross_amount: BigInt(amounts.gross_amount),
          platform_fee: BigInt(amounts.platform_fee),
          provider_fee: BigInt(amounts.provider_fee),
          net_amount: BigInt(amounts.net_amount),
          status: 'pending_approval',
          requested_by: requestedBy,
          provider_reference: `${this.provider.name.toUpperCase()}-PAYOUT-${randomUUID()}`,
          idempotency_key: `payout-${round.id}-${randomUUID().slice(0, 12)}`,
        },
        include: payoutInclude,
      });

      return {
        ...this.serializePayout(payout),
        reused: false,
        partial: eligibility.partial,
        guarantee_used: eligibility.guarantee_used,
        message:
          requestedBy === null
            ? 'Demande enregistrée. Vous êtes le seul gestionnaire : vous pouvez l’approuver avec un OTP.'
            : 'Demande enregistrée. Un autre gestionnaire doit l’approuver avec un OTP.',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.payouts.findFirst({
          where: { round_id: round.id },
          orderBy: { created_at: 'desc' },
          include: payoutInclude,
        });
        if (existing) return { ...this.serializePayout(existing), reused: true };
      }
      throw error;
    }
  }

  async approve(actor: Actor, roundId: string, otpCode: string | undefined) {
    const round = await this.loadRound(roundId);
    await this.assertManager(actor, round.group_id);

    const payoutRow = this.activePayout(round);
    if (!payoutRow) {
      const failed = round.payouts.find((payout) => payout.status === 'failed');
      if (failed) {
        throw new ConflictException({
          code:
            failed.attempts >= MAX_ATTEMPTS ? 'PAYOUT_REQUIRES_REVIEW' : 'PAYOUT_RETRY_SCHEDULED',
          message:
            failed.attempts >= MAX_ATTEMPTS
              ? 'Le décaissement a échoué 3 fois. Un administrateur doit intervenir.'
              : 'Le décaissement a échoué. Une nouvelle tentative est planifiée automatiquement.',
        });
      }
      throw new NotFoundException({
        code: 'PAYOUT_NOT_FOUND',
        message: 'Aucune demande de décaissement pour ce tour.',
      });
    }

    const payout = await this.prisma.payouts.findUniqueOrThrow({
      where: { id: payoutRow.id },
      include: payoutInclude,
    });

    if (payout.status === 'success') {
      return { ...this.serializePayout(payout), already_executed: true };
    }
    if (payout.status === 'processing') {
      throw new ConflictException({
        code: 'PAYOUT_IN_PROGRESS',
        message: 'Le décaissement est en cours d’exécution.',
      });
    }

    if (payout.requested_by && payout.requested_by === actor.id) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'Le demandeur d’un décaissement ne peut pas l’approuver lui-même.',
      });
    }

    if (!otpCode) {
      const user = await this.prisma.users.findUniqueOrThrow({
        where: { id: actor.id },
        select: { phone: true },
      });
      const code = await this.otp.issue({
        userId: actor.id,
        target: user.phone,
        purpose: 'payout_approval',
      });
      await this.sms.send(
        user.phone,
        `Tontine : code ${code} pour approuver le décaissement de ${round.groups.name}. Valable 10 minutes.`,
      );
      return {
        otp_required: true,
        payout_id: payout.id,
        message: 'Un code de confirmation vous a été envoyé par SMS.',
      };
    }

    const user = await this.prisma.users.findUniqueOrThrow({
      where: { id: actor.id },
      select: { phone: true },
    });
    await this.otp.consume(user.phone, 'payout_approval', otpCode);

    const threshold =
      round.groups.dual_approval_threshold === null
        ? null
        : Number(round.groups.dual_approval_threshold);
    const needsSecond = threshold !== null && Number(payout.gross_amount) >= threshold;

    if (needsSecond) {
      if (!payout.approved_by) {
        const updated = await this.prisma.payouts.update({
          where: { id: payout.id },
          data: { approved_by: actor.id, status: 'approved' },
          include: payoutInclude,
        });
        await this.audit.record({
          actorId: actor.id,
          action: 'payout.approve_first',
          entity: 'payouts',
          entityId: payout.id,
          metadata: { round_id: round.id, gross_amount: Number(payout.gross_amount) },
        });
        return {
          ...this.serializePayout(updated),
          requires_second_approval: true,
          message:
            'Première validation enregistrée. Un second approbateur distinct doit confirmer le décaissement.',
        };
      }
      if (payout.second_approved_by) {
        throw new ConflictException({
          code: 'PAYOUT_ALREADY_APPROVED',
          message: 'Ce décaissement a déjà reçu ses deux validations.',
        });
      }
      if (payout.approved_by === actor.id) {
        throw new ForbiddenException({
          code: 'SELF_APPROVAL_FORBIDDEN',
          message: 'Le second approbateur doit être différent du premier.',
        });
      }
      const updated = await this.prisma.payouts.update({
        where: { id: payout.id },
        data: { second_approved_by: actor.id },
        include: payoutInclude,
      });
      const executed = await this.execute(updated.id);
      await this.audit.record({
        actorId: actor.id,
        action: 'payout.approve',
        entity: 'payouts',
        entityId: payout.id,
        metadata: { round_id: round.id, second_approval: true },
      });
      return {
        ...executed,
        requires_second_approval: false,
        message: 'Double validation complète. Décaissement exécuté.',
      };
    }

    if (payout.approved_by) {
      throw new ConflictException({
        code: 'PAYOUT_ALREADY_APPROVED',
        message: 'Ce décaissement a déjà été approuvé.',
      });
    }

    await this.prisma.payouts.update({
      where: { id: payout.id },
      data: { approved_by: actor.id },
    });
    const executed = await this.execute(payout.id);
    await this.audit.record({
      actorId: actor.id,
      action: 'payout.approve',
      entity: 'payouts',
      entityId: payout.id,
      metadata: { round_id: round.id },
    });
    return { ...executed, requires_second_approval: false };
  }

  // ---------- Exécution ----------

  private async execute(payoutId: string) {
    const claim = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.payouts.findUnique({
        where: { id: payoutId },
        select: { round_id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'PAYOUT_NOT_FOUND',
          message: 'Décaissement introuvable.',
        });
      }

      // Verrou du tour : un seul décaissement peut progresser à la fois.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM rounds WHERE id = ${existing.round_id}::uuid FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Tour introuvable.' });
      }

      const fresh = await tx.payouts.findUnique({
        where: { id: payoutId },
        include: payoutInclude,
      });
      if (!fresh) {
        throw new NotFoundException({
          code: 'PAYOUT_NOT_FOUND',
          message: 'Décaissement introuvable.',
        });
      }
      if (fresh.status === 'success') return { already: true, payout: fresh };
      if (fresh.status === 'processing') {
        throw new ConflictException({
          code: 'PAYOUT_IN_PROGRESS',
          message: 'Le décaissement est déjà en cours.',
        });
      }
      if (!['pending_approval', 'approved', 'failed'].includes(fresh.status)) {
        throw new ConflictException({
          code: 'PAYOUT_NOT_EXECUTABLE',
          message: 'Ce décaissement ne peut pas être exécuté.',
        });
      }

      if (fresh.status !== 'failed') {
        const threshold =
          fresh.rounds.groups.dual_approval_threshold === null
            ? null
            : Number(fresh.rounds.groups.dual_approval_threshold);
        const needsSecond = threshold !== null && Number(fresh.gross_amount) >= threshold;

        if (!fresh.approved_by) {
          throw new ConflictException({
            code: 'PAYOUT_NOT_APPROVED',
            message: 'Le décaissement doit être approuvé avec un OTP avant exécution.',
          });
        }
        if (needsSecond && !fresh.second_approved_by) {
          throw new ConflictException({
            code: 'PAYOUT_SECOND_APPROVAL_REQUIRED',
            message: 'Un second approbateur distinct doit valider ce décaissement.',
          });
        }
      }

      const updated = await tx.payouts.update({
        where: { id: payoutId },
        data: { status: 'processing', attempts: { increment: 1 } },
        include: payoutInclude,
      });
      return { already: false, payout: updated };
    });

    if (claim.already) {
      return { ...this.serializePayout(claim.payout), already_executed: true };
    }

    const payout = claim.payout;
    const account = payout.payout_accounts;
    let failureReason: string | null = null;
    let success = false;

    try {
      const result = await this.provider.disburse({
        payoutId: payout.id,
        providerReference: payout.provider_reference ?? `PAYOUT-${payout.id}`,
        amount: Number(payout.net_amount),
        method: account.type,
        accountNumber: account.account_number,
        idempotencyKey: payout.idempotency_key,
      });

      if (result.status === 'success') {
        success = true;
      } else if (result.status === 'processing') {
        this.logger.log(`Décaissement ${payout.id} accepté, en attente du webhook fournisseur.`);
        return {
          ...this.serializePayout(payout),
          status: 'processing',
          message: 'Virement accepté, confirmation fournisseur en attente.',
        };
      } else {
        failureReason = result.failureReason ?? 'Virement refusé par l’agrégateur.';
      }
    } catch (error) {
      failureReason = `Agrégateur indisponible : ${(error as Error).message}`;
    }

    if (!success) {
      return this.markFailed(payout.id, failureReason ?? 'Virement refusé par l’agrégateur.');
    }

    const finalized = await this.finalizeSuccess(payout.id);
    this.provider.notifySettled?.({
      direction: 'out',
      providerReference: payout.provider_reference ?? payout.id,
      amount: Number(payout.net_amount),
    });

    try {
      await this.notifications.notify({
        userId: payout.group_members.user_id,
        template: 'payout_success',
        payload: {
          amount: Number(payout.net_amount),
          group_name: payout.rounds.groups.name,
          round_number: payout.rounds.round_number,
        },
        dedupeKey: `payout:${payout.id}`,
      });
    } catch (error) {
      this.logger.warn(`Notification de décaissement non envoyée : ${(error as Error).message}`);
    }

    return finalized;
  }

  private async markFailed(payoutId: string, reason: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payouts.findUnique({
        where: { id: payoutId },
        include: payoutInclude,
      });
      if (!payout) {
        throw new NotFoundException({
          code: 'PAYOUT_NOT_FOUND',
          message: 'Décaissement introuvable.',
        });
      }
      if (payout.status === 'success') return payout;

      const failed = await tx.payouts.update({
        where: { id: payoutId },
        data: { status: 'failed', failure_reason: reason },
        include: payoutInclude,
      });

      if (failed.attempts >= MAX_ATTEMPTS) {
        await tx.rounds.updateMany({
          where: { id: failed.round_id, status: 'ready' },
          data: { status: 'failed' },
        });
        this.logger.error(
          `ALERTE SUPER ADMIN : décaissement ${failed.id} (tour ${failed.rounds.round_number}, groupe ${failed.rounds.groups.name}) en échec après ${failed.attempts} tentatives.`,
        );
      } else {
        this.logger.warn(
          `Décaissement ${failed.id} en échec (tentative ${failed.attempts}/${MAX_ATTEMPTS}) : ${reason}`,
        );
      }
      return failed;
    });

    return {
      ...this.serializePayout(updated),
      retryable: updated.attempts < MAX_ATTEMPTS,
    };
  }

  private async finalizeSuccess(payoutId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.payouts.findUnique({
        where: { id: payoutId },
        select: { round_id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'PAYOUT_NOT_FOUND',
          message: 'Décaissement introuvable.',
        });
      }

      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM rounds WHERE id = ${existing.round_id}::uuid FOR UPDATE
      `;

      const payout = await tx.payouts.findUnique({
        where: { id: payoutId },
        include: payoutInclude,
      });
      if (!payout) {
        throw new NotFoundException({
          code: 'PAYOUT_NOT_FOUND',
          message: 'Décaissement introuvable.',
        });
      }
      if (payout.status === 'success') return { already: true, payout };
      if (payout.status !== 'processing') {
        throw new ConflictException({
          code: 'PAYOUT_NOT_PROCESSING',
          message: 'Le décaissement n’est pas en cours de traitement.',
        });
      }

      const round = payout.rounds;
      const escrow = await tx.escrow_accounts.findUnique({
        where: { group_id: round.group_id },
      });
      if (!escrow) {
        throw new ConflictException({
          code: 'ESCROW_NOT_FOUND',
          message: 'Compte séquestre introuvable pour ce groupe.',
        });
      }

      const gross = Number(payout.gross_amount);
      const net = Number(payout.net_amount);
      const platformFee = Number(payout.platform_fee);
      const providerFee = Number(payout.provider_fee);
      // La part collectée ne peut pas excéder le brut ; le reste vient de la garantie.
      const collectedPart = Math.min(gross, Math.max(0, Number(round.collected_amount)));
      const guaranteeUsed = Math.min(
        Math.max(0, gross - collectedPart),
        Math.max(0, Number(escrow.guarantee_balance)),
      );
      const now = new Date();

      if (net > 0) {
        await this.ledger.debitPayout(tx, {
          escrowAccountId: escrow.id,
          roundId: round.id,
          amount: BigInt(net),
          referenceTable: 'payouts',
          referenceId: payout.id,
          description: `Décaissement tour ${round.round_number} (net bénéficiaire)`,
        });
      }
      if (platformFee > 0) {
        await this.ledger.debitPlatformFee(tx, {
          escrowAccountId: escrow.id,
          roundId: round.id,
          amount: BigInt(platformFee),
          referenceTable: 'payouts',
          referenceId: payout.id,
          description: `Frais plateforme tour ${round.round_number}`,
        });
      }
      if (providerFee > 0) {
        await this.ledger.debitProviderFee(tx, {
          escrowAccountId: escrow.id,
          roundId: round.id,
          amount: BigInt(providerFee),
          referenceTable: 'payouts',
          referenceId: payout.id,
          description: `Frais opérateur tour ${round.round_number}`,
        });
      }

      await tx.escrow_accounts.update({
        where: { id: escrow.id },
        data: {
          balance_cached: { decrement: BigInt(collectedPart) },
          guarantee_balance: { decrement: BigInt(guaranteeUsed) },
          updated_at: now,
        },
      });

      if (guaranteeUsed > 0) {
        // La garantie a avancé le manque : le bénéficiaire en devient débiteur.
        await tx.member_debts.create({
          data: {
            member_id: payout.beneficiary_member_id,
            round_id: round.id,
            amount: BigInt(guaranteeUsed),
            status: 'open',
          },
        });
      }

      const executed = await tx.payouts.update({
        where: { id: payout.id },
        data: { status: 'success', executed_at: now, failure_reason: null },
        include: payoutInclude,
      });

      await tx.rounds.update({
        where: { id: round.id },
        data: { status: 'paid_out', closed_at: now },
      });

      const nextRound = await tx.rounds.findFirst({
        where: {
          group_id: round.group_id,
          round_number: { gt: round.round_number },
          status: 'scheduled',
        },
        orderBy: { round_number: 'asc' },
      });
      if (nextRound && utcDay(nextRound.opens_on) <= utcDay(now)) {
        await tx.rounds.update({ where: { id: nextRound.id }, data: { status: 'open' } });
      }

      return { already: false, payout: executed };
    });

    if (!result.already) {
      this.logger.log(
        `Décaissement ${result.payout.id} exécuté (${Number(result.payout.net_amount)} XAF net).`,
      );
    }

    return {
      ...this.serializePayout(result.payout),
      already_executed: result.already,
      message: 'Décaissement exécuté. Le tour est clôturé.',
    };
  }

  // ---------- Consultation ----------

  async getPayout(actor: Actor, payoutId: string) {
    const payout = await this.prisma.payouts.findUnique({
      where: { id: payoutId },
      include: payoutInclude,
    });
    if (!payout) {
      throw new NotFoundException({
        code: 'PAYOUT_NOT_FOUND',
        message: 'Décaissement introuvable.',
      });
    }
    await this.assertViewer(actor, payout.rounds.group_id);
    return this.serializePayout(payout);
  }

  async getRoundPayout(actor: Actor, roundId: string) {
    const round = await this.loadRound(roundId);
    await this.assertViewer(actor, round.group_id);

    const latest = round.payouts[0] ?? null;
    const full = latest
      ? await this.prisma.payouts.findUnique({ where: { id: latest.id }, include: payoutInclude })
      : null;
    const { eligibility } = await this.buildEligibility(round, false);

    return {
      payout: full ? this.serializePayout(full) : null,
      eligibility,
    };
  }

  async getReceipt(actor: Actor, payoutId: string) {
    const payout = await this.prisma.payouts.findUnique({
      where: { id: payoutId },
      include: payoutInclude,
    });
    if (!payout) {
      throw new NotFoundException({
        code: 'PAYOUT_NOT_FOUND',
        message: 'Décaissement introuvable.',
      });
    }
    await this.assertViewer(actor, payout.rounds.group_id);

    if (payout.status !== 'success' || !payout.executed_at) {
      throw new ConflictException({
        code: 'PAYOUT_RECEIPT_NOT_AVAILABLE',
        message: 'Le justificatif sera disponible dès l’exécution du décaissement.',
      });
    }

    const date = payout.executed_at.toISOString().slice(0, 10).replace(/-/g, '');
    const reference = `DEC-${date}-${payout.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const beneficiary = payout.group_members.users_group_members_user_idTousers;

    const pdf = buildPayoutReceiptPdf({
      receiptNumber: reference,
      executedAt: payout.executed_at,
      beneficiaryName: beneficiary.full_name,
      beneficiaryPhone: beneficiary.phone,
      accountType: payout.payout_accounts.type,
      accountNumber: maskAccount(payout.payout_accounts.account_number),
      groupName: payout.rounds.groups.name,
      roundNumber: payout.rounds.round_number,
      grossAmount: Number(payout.gross_amount),
      platformFee: Number(payout.platform_fee),
      providerFee: Number(payout.provider_fee),
      netAmount: Number(payout.net_amount),
      providerReference: payout.provider_reference ?? '—',
    });

    return { filename: `${reference}.pdf`, buffer: pdf, reference };
  }

  // ---------- Jobs ----------

  /** Prépare les décaissements des tours éligibles (validation président requise). */
  async processEligiblePayouts(now = new Date()): Promise<{ created: number; skipped: number }> {
    const today = new Date(utcDay(now));
    const rounds = await this.prisma.rounds.findMany({
      where: {
        status: { in: ['open', 'collecting', 'ready'] },
        payout_date: { lte: today },
      },
      include: roundInclude,
    });

    let created = 0;
    let skipped = 0;

    for (const round of rounds) {
      if (this.activePayout(round)) {
        skipped += 1;
        continue;
      }
      if (round.payouts.some((payout) => payout.status === 'failed')) {
        skipped += 1;
        continue;
      }

      const { eligibility, account, escrow } = await this.buildEligibility(round, false);
      if (!eligibility.eligible || !account) {
        skipped += 1;
        continue;
      }

      const amounts = computePayoutAmounts(
        eligibility.gross_amount,
        round.groups.platform_fee_type,
        Number(round.groups.platform_fee_value),
      );

      try {
        await this.prisma.payouts.create({
          data: {
            round_id: round.id,
            beneficiary_member_id: round.beneficiary_member_id,
            destination_account_id: account.id,
            gross_amount: BigInt(amounts.gross_amount),
            platform_fee: BigInt(amounts.platform_fee),
            provider_fee: BigInt(amounts.provider_fee),
            net_amount: BigInt(amounts.net_amount),
            status: 'pending_approval',
            requested_by: null,
            provider_reference: `${this.provider.name.toUpperCase()}-PAYOUT-${randomUUID()}`,
            idempotency_key: `payout-${round.id}-job-${randomUUID().slice(0, 8)}`,
          },
        });
        created += 1;
        this.logger.log(
          `Décaissement préparé pour le tour ${round.round_number} (groupe ${round.groups.name}), garantie utilisée ${eligibility.guarantee_used} XAF, escrow ${escrow?.id ?? '—'}.`,
        );
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return { created, skipped };
  }

  /** Relance automatique des décaissements en échec (maximum 3 tentatives). */
  async retryFailedPayouts(): Promise<{ retried: number; succeeded: number }> {
    const failed = await this.prisma.payouts.findMany({
      where: { status: 'failed', attempts: { lt: MAX_ATTEMPTS } },
      include: payoutInclude,
      orderBy: { created_at: 'asc' },
      take: 50,
    });

    let retried = 0;
    let succeeded = 0;

    for (const payout of failed) {
      if (!['ready', 'failed'].includes(payout.rounds.status)) continue;
      retried += 1;
      try {
        const result = await this.execute(payout.id);
        if (result.status === 'success') succeeded += 1;
      } catch (error) {
        this.logger.warn(
          `Relance du décaissement ${payout.id} impossible : ${(error as Error).message}`,
        );
      }
    }

    return { retried, succeeded };
  }
}

/** Délai anti-fraude exposé pour la documentation et les tests. */
export const PAYOUT_ACCOUNT_DELAY = PAYOUT_ACCOUNT_DELAY_MS;
