import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CollectInput,
  CollectResult,
  DisburseInput,
  DisburseResult,
  PaymentProvider,
  ProviderReport,
  WebhookEvent,
} from './payment-provider';

/**
 * Squelette d'adaptateur pour un agrégateur réel (MTN MoMo / Orange Money).
 * Aucune clé n'est codée en dur : les secrets viennent de l'environnement.
 * L'intégration doit être complétée et testée en sandbox avant activation.
 */
export class RealPaymentProvider implements PaymentProvider {
  readonly name = 'real';
  private readonly logger = new Logger(RealPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  async collect(_input: CollectInput): Promise<CollectResult> {
    const apiKey = this.config.get<string>('REAL_PROVIDER_API_KEY', '');
    if (!apiKey) {
      throw new Error('REAL_PROVIDER_API_KEY est absent : agrégateur réel non configuré.');
    }
    this.logger.error('Adaptateur réel non implémenté : utilisez PAYMENT_PROVIDER=mock.');
    throw new Error('Intégration de l’agrégateur réel non disponible.');
  }

  parseWebhook(_rawBody: Buffer, _signature: string | undefined): WebhookEvent | null {
    // La vérification de signature propre à l'agrégateur doit être implémentée ici.
    return null;
  }

  async disburse(_input: DisburseInput): Promise<DisburseResult> {
    this.logger.error('Décaissement réel non implémenté : utilisez PAYMENT_PROVIDER=mock.');
    throw new Error('Intégration de l’agrégateur réel non disponible.');
  }

  async report(_since?: Date): Promise<ProviderReport> {
    this.logger.error('Rapport réel non implémenté : utilisez PAYMENT_PROVIDER=mock.');
    throw new Error('Rapport de l’agrégateur réel non disponible.');
  }
}
