/**
 * Règles pures du décaissement (§8.1 et §8.3 du dossier de conception).
 * Aucune dépendance à Prisma : ces fonctions sont testables isolément et
 * constituent la seule référence pour l'éligibilité et les montants.
 */

export type PayoutRule = 'strict' | 'flexible';

export interface PayoutRoundSnapshot {
  status: string;
  collected_amount: number;
  expected_amount: number;
  payout_date: Date;
}

export interface PayoutAccountSnapshot {
  verified_at: Date | null;
  active_from: Date;
}

export interface PayoutEligibilityInput {
  round: PayoutRoundSnapshot;
  beneficiaryStatus: string;
  account: PayoutAccountSnapshot | null;
  /** Solde disponible de la caisse de garantie (en XAF). */
  guaranteeAvailable: number;
  /** Un payout pending_approval/approved/processing/success existe déjà. */
  hasActivePayout: boolean;
  /** Le président accepte explicitement un versement partiel (règle souple). */
  allowPartial: boolean;
  rule: PayoutRule;
  now: Date;
}

export type IneligibilityReason =
  | 'ROUND_NOT_ELIGIBLE'
  | 'PAYOUT_ALREADY_ACTIVE'
  | 'BENEFICIARY_INACTIVE'
  | 'DESTINATION_ACCOUNT_REQUIRED'
  | 'DESTINATION_ACCOUNT_UNVERIFIED'
  | 'DESTINATION_ACCOUNT_TOO_RECENT'
  | 'PAYOUT_DATE_NOT_REACHED'
  | 'COLLECTION_INCOMPLETE';

export interface PayoutEligibility {
  eligible: boolean;
  reasons: IneligibilityReason[];
  rule: PayoutRule;
  collected: number;
  expected: number;
  shortfall: number;
  /** Montant prélevé sur la caisse de garantie pour combler le manque. */
  guarantee_used: number;
  partial: boolean;
  gross_amount: number;
}

const ELIGIBLE_ROUND_STATUSES = ['open', 'collecting', 'ready'];
/** Un compte de réception doit être actif depuis au moins 24 h (anti-fraude). */
export const PAYOUT_ACCOUNT_DELAY_MS = 24 * 3_600_000;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/**
 * Implémente §8.3 :
 * - STRICTE  : collected == expected, quel que soit le jour.
 * - SOUPLE   : date >= payout_date ET (collected + garantie >= expected
 *              OU le président accepte un versement partiel).
 * Dans tous les cas : tour éligible, aucun payout actif, bénéficiaire actif,
 * compte de réception vérifié et actif depuis plus de 24 h.
 */
export function isEligibleForPayout(input: PayoutEligibilityInput): PayoutEligibility {
  const reasons: IneligibilityReason[] = [];
  const collected = input.round.collected_amount;
  const expected = input.round.expected_amount;
  const shortfall = Math.max(0, expected - collected);
  const guaranteeAvailable = Math.max(0, input.guaranteeAvailable);

  if (!ELIGIBLE_ROUND_STATUSES.includes(input.round.status)) {
    reasons.push('ROUND_NOT_ELIGIBLE');
  }
  if (input.hasActivePayout) {
    reasons.push('PAYOUT_ALREADY_ACTIVE');
  }
  if (input.beneficiaryStatus !== 'active') {
    reasons.push('BENEFICIARY_INACTIVE');
  }
  if (!input.account) {
    reasons.push('DESTINATION_ACCOUNT_REQUIRED');
  } else {
    if (!input.account.verified_at) {
      reasons.push('DESTINATION_ACCOUNT_UNVERIFIED');
    }
    if (input.account.active_from.getTime() > input.now.getTime()) {
      reasons.push('DESTINATION_ACCOUNT_TOO_RECENT');
    }
  }

  let guaranteeUsed = 0;
  let partial = false;

  if (input.rule === 'strict') {
    if (collected < expected) {
      reasons.push('COLLECTION_INCOMPLETE');
    }
  } else {
    const reached = utcDay(input.now) >= utcDay(input.round.payout_date);
    if (!reached) {
      reasons.push('PAYOUT_DATE_NOT_REACHED');
    }
    if (collected < expected) {
      const coverable = collected + guaranteeAvailable >= expected;
      if (coverable) {
        guaranteeUsed = shortfall;
      } else if (input.allowPartial && reached) {
        partial = true;
      } else {
        reasons.push('COLLECTION_INCOMPLETE');
      }
    }
  }

  const eligible = reasons.length === 0;
  const grossAmount = eligible ? collected + guaranteeUsed : 0;

  return {
    eligible,
    reasons: [...new Set(reasons)],
    rule: input.rule,
    collected,
    expected,
    shortfall,
    guarantee_used: eligible ? guaranteeUsed : 0,
    partial: eligible && partial,
    gross_amount: grossAmount,
  };
}

export interface PayoutAmounts {
  gross_amount: number;
  platform_fee: number;
  provider_fee: number;
  net_amount: number;
}

/**
 * §8.1 — Tous les calculs sont en entiers XAF. Arrondi des pourcentages à
 * l'unité inférieure ; le reste d'arrondi profite aux frais de la plateforme.
 */
export function computePayoutAmounts(
  grossAmount: number,
  feeType: 'fixed' | 'percent',
  feeValue: number,
  providerFee = 0,
): PayoutAmounts {
  const gross = Math.max(0, Math.floor(grossAmount));
  const provider = Math.max(0, Math.floor(providerFee));
  let platformFee =
    feeType === 'fixed' ? Math.floor(feeValue) : Math.floor((gross * feeValue) / 10_000);

  platformFee = Math.max(0, platformFee);
  if (platformFee + provider > gross) {
    // Ne jamais produire un net négatif : les frais sont plafonnés au brut.
    platformFee = Math.max(0, gross - provider);
  }

  const net = gross - platformFee - provider;
  return {
    gross_amount: gross,
    platform_fee: platformFee,
    provider_fee: provider,
    net_amount: net,
  };
}

const PAYOUT_TRANSITIONS: Record<string, string[]> = {
  pending_approval: ['approved', 'processing', 'failed', 'cancelled'],
  approved: ['processing', 'failed', 'cancelled'],
  processing: ['success', 'failed'],
  failed: ['processing', 'cancelled'],
  success: [],
  cancelled: [],
};

const ROUND_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['open', 'cancelled'],
  open: ['collecting', 'ready', 'cancelled'],
  collecting: ['ready', 'cancelled'],
  ready: ['paid_out', 'failed', 'cancelled'],
  failed: ['ready'],
  paid_out: [],
  cancelled: [],
};

/** Refuse toute transition non prévue par la machine à états (§5). */
export function canTransition(kind: 'payout' | 'round', from: string, to: string): boolean {
  const table = kind === 'payout' ? PAYOUT_TRANSITIONS : ROUND_TRANSITIONS;
  return (table[from] ?? []).includes(to);
}
