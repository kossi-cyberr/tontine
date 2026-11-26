import { apiDownload, apiFetch } from './api';

export type PaymentMethod = 'mtn_momo' | 'orange_money' | 'bank';
export type PaymentStatus = 'initiated' | 'pending' | 'confirmed' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  contribution_id: string;
  amount: number;
  provider_fee: number;
  method: PaymentMethod | null;
  status: PaymentStatus;
  receipt_number: string | null;
  provider: string;
  provider_reference: string | null;
  payer_number: string | null;
  failure_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  group?: { id: string; name: string };
  round_number?: number;
}

export interface Escrow {
  account_id: string | null;
  balance: number;
  cached_balance?: number;
  guarantee_balance: number;
  currency: string;
  consistent: boolean;
}

export interface LedgerEntry {
  id: string;
  type: string;
  debit: number;
  credit: number;
  description: string | null;
  round_id: string | null;
  created_at: string;
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  initiated: 'Initié',
  pending: 'En attente',
  confirmed: 'Confirmé',
  failed: 'Échec',
  refunded: 'Remboursé',
};

export const PAYMENT_STATUS_TONE: Record<
  PaymentStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'brand'
> = {
  initiated: 'brand',
  pending: 'warning',
  confirmed: 'success',
  failed: 'danger',
  refunded: 'neutral',
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  mtn_momo: 'MTN Mobile Money',
  orange_money: 'Orange Money',
  bank: 'Virement bancaire',
};

export type PayoutStatus =
  'pending_approval' | 'approved' | 'processing' | 'success' | 'failed' | 'cancelled';

export interface Payout {
  id: string;
  round_id: string;
  round_number: number;
  group: { id: string; name: string };
  beneficiary: { id: string; user_id: string; full_name: string; phone: string };
  destination: { type: PaymentMethod; account_number: string; holder_name: string };
  gross_amount: number;
  platform_fee: number;
  provider_fee: number;
  net_amount: number;
  status: PayoutStatus;
  attempts: number;
  failure_reason: string | null;
  requested_by: string | null;
  approved_by: string | null;
  second_approved_by: string | null;
  provider_reference: string | null;
  executed_at: string | null;
  created_at: string;
  reused?: boolean;
  retryable?: boolean;
  already_executed?: boolean;
}

export interface PayoutEligibility {
  eligible: boolean;
  reasons: string[];
  rule: 'strict' | 'flexible';
  collected: number;
  expected: number;
  shortfall: number;
  guarantee_used: number;
  partial: boolean;
  gross_amount: number;
}

export interface RoundPayoutState {
  payout: Payout | null;
  eligibility: PayoutEligibility;
}

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending_approval: 'En attente d’approbation',
  approved: 'Approuvé (2e validation requise)',
  processing: 'En cours',
  success: 'Versé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

export const PAYOUT_STATUS_TONE: Record<
  PayoutStatus,
  'neutral' | 'success' | 'warning' | 'danger' | 'brand'
> = {
  pending_approval: 'warning',
  approved: 'brand',
  processing: 'brand',
  success: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const PAYOUT_REASON_LABELS: Record<string, string> = {
  ROUND_NOT_ELIGIBLE: 'Le tour n’est pas encore prêt.',
  PAYOUT_ALREADY_ACTIVE: 'Un décaissement existe déjà pour ce tour.',
  BENEFICIARY_INACTIVE: 'Le bénéficiaire n’est plus actif.',
  DESTINATION_ACCOUNT_REQUIRED: 'Le bénéficiaire doit enregistrer un compte de réception.',
  DESTINATION_ACCOUNT_UNVERIFIED: 'Le compte de réception n’est pas vérifié.',
  DESTINATION_ACCOUNT_TOO_RECENT:
    'Compte de réception modifié depuis moins de 24 h (délai de sécurité).',
  PAYOUT_DATE_NOT_REACHED: 'La date de décaissement n’est pas encore atteinte.',
  COLLECTION_INCOMPLETE: 'La collecte du tour est incomplète.',
};

export const LEDGER_TYPE_LABELS: Record<string, string> = {
  contribution: 'Cotisation',
  penalty: 'Pénalité',
  payout: 'Décaissement',
  platform_fee: 'Frais plateforme',
  provider_fee: 'Frais opérateur',
  refund: 'Remboursement',
  guarantee_in: 'Entrée garantie',
  guarantee_out: 'Sortie garantie',
  adjustment: 'Ajustement',
};

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export const paymentsApi = {
  pay: (
    contributionId: string,
    payload: { method: PaymentMethod; payer_number: string },
    key: string,
  ) =>
    apiFetch<Payment>(`/contributions/${contributionId}/pay`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify(payload),
    }),
  get: (paymentId: string) => apiFetch<Payment>(`/payments/${paymentId}`),
  listMine: () => apiFetch<Payment[]>('/me/payments'),
  escrow: (groupId: string) => apiFetch<Escrow>(`/groups/${groupId}/escrow`),
  ledger: (groupId: string, page = 1) =>
    apiFetch<LedgerEntry[]>(`/groups/${groupId}/ledger?page=${page}`),
  async downloadReceipt(paymentId: string): Promise<void> {
    const blob = await apiDownload(`/payments/${paymentId}/receipt`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recu-${paymentId.slice(0, 8)}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
};

export const payoutsApi = {
  forRound: (roundId: string) => apiFetch<RoundPayoutState>(`/rounds/${roundId}/payout`),
  request: (roundId: string, allowPartial = false) =>
    apiFetch<Payout>(`/rounds/${roundId}/payout/request`, {
      method: 'POST',
      body: JSON.stringify({ allow_partial: allowPartial }),
    }),
  approve: (roundId: string, otpCode?: string) =>
    apiFetch<
      Payout & { otp_required?: boolean; requires_second_approval?: boolean; message?: string }
    >(`/rounds/${roundId}/payout/approve`, {
      method: 'POST',
      body: JSON.stringify(otpCode ? { otp_code: otpCode } : {}),
    }),
  async downloadReceipt(payoutId: string): Promise<void> {
    const blob = await apiDownload(`/payouts/${payoutId}/receipt`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `decaissement-${payoutId.slice(0, 8)}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
};
