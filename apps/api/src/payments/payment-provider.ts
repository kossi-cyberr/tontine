import type { account_type } from '@prisma/client';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CollectInput {
  paymentId: string;
  providerReference: string;
  amount: number;
  method: account_type;
  payerNumber: string;
  idempotencyKey: string;
}

export interface CollectResult {
  providerReference: string;
  status: 'pending' | 'failed';
  providerFee?: number;
  failureReason?: string;
}

export interface WebhookEvent {
  eventId: string;
  providerReference: string;
  status: 'confirmed' | 'failed';
  amount: number;
  occurredAt?: string;
  reason?: string;
}

export interface DisburseInput {
  payoutId: string;
  providerReference: string;
  /** Montant net effectivement versé au bénéficiaire. */
  amount: number;
  method: account_type;
  accountNumber: string;
  idempotencyKey: string;
}

export interface DisburseResult {
  providerReference: string;
  status: 'success' | 'processing' | 'failed';
  failureReason?: string;
}

/** Rapport de règlement de l'agrégateur, base de la réconciliation (E-04). */
export interface ProviderReport {
  total_in: number;
  total_out: number;
  currency: string;
  generated_at: string;
}

export interface SettlementNotice {
  direction: 'in' | 'out';
  providerReference: string;
  amount: number;
}

/**
 * Adaptateur d'agrégateur de paiement. Le statut « payé » ne provient jamais
 * du navigateur : uniquement du webhook vérifié (ou d'une vérification serveur).
 */
export interface PaymentProvider {
  readonly name: string;
  collect(input: CollectInput): Promise<CollectResult>;
  /** Retourne null si la signature est absente ou invalide. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): WebhookEvent | null;
  /** Ordonne le virement du net au bénéficiaire (décaissement). */
  disburse(input: DisburseInput): Promise<DisburseResult>;
  /** Rapport agrégé utilisé par la réconciliation quotidienne. */
  report(since?: Date): Promise<ProviderReport>;
  /**
   * Informe le fournisseur d'un règlement confirmé. Le mock s'en sert pour
   * produire un rapport cohérent avec le grand livre.
   */
  notifySettled?(notice: SettlementNotice): void;
}
