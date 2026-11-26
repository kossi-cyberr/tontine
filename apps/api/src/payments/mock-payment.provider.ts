import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CollectInput,
  CollectResult,
  DisburseInput,
  DisburseResult,
  PaymentProvider,
  ProviderReport,
  SettlementNotice,
  WebhookEvent,
} from './payment-provider';

/** Calcule la signature HMAC-SHA256 attendue pour un webhook mock. */
export function signMockWebhook(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Agrégateur de développement : aucune collecte réelle.
 * - Un numéro se terminant par 0000 simule un échec immédiat.
 * - Un compte de réception se terminant par 5555 fait échouer le premier
 *   décaissement (permet de tester la relance), puis réussit.
 * - En développement, un webhook de confirmation signé est envoyé à l'API
 *   après quelques secondes, afin de tester le vrai chemin webhook.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentProvider.name);
  private totalIn = 0;
  private totalOut = 0;
  private readonly failedOnce = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  /** Compteurs en mémoire (mock uniquement) : base du rapport de réconciliation. */
  notifySettled(notice: SettlementNotice): void {
    if (notice.direction === 'in') this.totalIn += notice.amount;
    else this.totalOut += notice.amount;
  }

  async report(_since?: Date): Promise<ProviderReport> {
    return {
      total_in: this.totalIn,
      total_out: this.totalOut,
      currency: 'XAF',
      generated_at: new Date().toISOString(),
    };
  }

  async disburse(input: DisburseInput): Promise<DisburseResult> {
    const digits = input.accountNumber.replace(/\D/g, '');

    if (digits.endsWith('0000')) {
      return {
        providerReference: input.providerReference,
        status: 'failed',
        failureReason: 'Compte de réception refusé par le fournisseur (simulation).',
      };
    }

    if (digits.endsWith('5555') && !this.failedOnce.has(input.payoutId)) {
      this.failedOnce.add(input.payoutId);
      return {
        providerReference: input.providerReference,
        status: 'failed',
        failureReason: 'Échec temporaire du virement (simulation, nouvelle tentative possible).',
      };
    }

    return { providerReference: input.providerReference, status: 'success' };
  }

  async collect(input: CollectInput): Promise<CollectResult> {
    const digits = input.payerNumber.replace(/\D/g, '');
    if (digits.endsWith('0000')) {
      return {
        providerReference: input.providerReference,
        status: 'failed',
        failureReason: 'Numéro refusé par le fournisseur (simulation).',
      };
    }

    this.scheduleConfirmation(input);

    return {
      providerReference: input.providerReference,
      status: 'pending',
      providerFee: 0,
    };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null {
    if (!signature) return null;

    const secret = this.config.get<string>('MOCK_PROVIDER_WEBHOOK_SECRET', '');
    const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    const expected = signMockWebhook(rawBody, secret);

    if (!safeEqual(received, expected)) return null;

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Record<string, unknown>;

    const eventId = typeof body.event_id === 'string' ? body.event_id.trim() : '';
    const providerReference =
      typeof body.provider_reference === 'string' ? body.provider_reference.trim() : '';
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const rawStatus =
      typeof body.status === 'string'
        ? body.status
        : body.type === 'payment.confirmed'
          ? 'confirmed'
          : body.type === 'payment.failed'
            ? 'failed'
            : '';

    if (!eventId || !providerReference) return null;
    if (!Number.isInteger(amount) || amount <= 0) return null;
    if (rawStatus !== 'confirmed' && rawStatus !== 'failed') return null;

    return {
      eventId: eventId.slice(0, 120),
      providerReference,
      status: rawStatus,
      amount,
      ...(typeof body.occurred_at === 'string' ? { occurredAt: body.occurred_at } : {}),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    };
  }

  private scheduleConfirmation(input: CollectInput): void {
    if (this.config.get<string>('MOCK_PROVIDER_AUTO_CONFIRM', 'false') !== 'true') return;

    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3001').replace(/\/$/, '');
    const secret = this.config.get<string>('MOCK_PROVIDER_WEBHOOK_SECRET', '');
    const payload = {
      event_id: `evt_${randomUUID()}`,
      provider_reference: input.providerReference,
      status: 'confirmed',
      amount: input.amount,
      occurred_at: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);

    const timer = setTimeout(() => {
      void fetch(`${apiUrl}/v1/webhooks/payments/mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signMockWebhook(body, secret),
        },
        body,
      })
        .then((response) => {
          if (!response.ok) {
            this.logger.warn(`Webhook mock refusé (HTTP ${response.status}).`);
          }
        })
        .catch((error: unknown) => {
          this.logger.warn(`Webhook mock non délivré : ${(error as Error).message}`);
        });
    }, 2_500);

    timer.unref();
  }
}
