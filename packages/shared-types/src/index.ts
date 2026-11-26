/**
 * Types et énumérations partagés entre l'API et le web.
 * Les valeurs reflètent exactement les ENUM de `db/migrations/..._init/migration.sql`.
 */

export const platformRoles = ['user', 'super_admin'] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const userStatuses = ['pending', 'active', 'suspended', 'closed'] as const;
export type UserStatus = (typeof userStatuses)[number];

export const kycStatuses = ['none', 'submitted', 'verified', 'rejected'] as const;
export type KycStatus = (typeof kycStatuses)[number];

export const groupRoles = ['president', 'treasurer', 'member', 'observer'] as const;
export type GroupRole = (typeof groupRoles)[number];

export const memberStatuses = ['invited', 'pending', 'active', 'suspended', 'left'] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const groupStatuses = ['draft', 'recruiting', 'active', 'completed', 'cancelled'] as const;
export type GroupStatus = (typeof groupStatuses)[number];

export const frequencyTypes = ['weekly', 'biweekly', 'monthly'] as const;
export type FrequencyType = (typeof frequencyTypes)[number];

export const payoutRules = ['strict', 'flexible'] as const;
export type PayoutRule = (typeof payoutRules)[number];

export const orderModes = ['random', 'manual'] as const;
export type OrderMode = (typeof orderModes)[number];

export const feeTypes = ['fixed', 'percent'] as const;
export type FeeType = (typeof feeTypes)[number];

export const cycleStatuses = ['planned', 'running', 'completed'] as const;
export type CycleStatus = (typeof cycleStatuses)[number];

export const roundStatuses = [
  'scheduled',
  'open',
  'collecting',
  'ready',
  'paid_out',
  'failed',
  'cancelled',
] as const;
export type RoundStatus = (typeof roundStatuses)[number];

export const contributionStatuses = [
  'pending',
  'paid',
  'late',
  'failed',
  'refunded',
  'waived',
] as const;
export type ContributionStatus = (typeof contributionStatuses)[number];

export const paymentStatuses = ['initiated', 'pending', 'confirmed', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export const payoutStatuses = [
  'pending_approval',
  'approved',
  'processing',
  'success',
  'failed',
  'cancelled',
] as const;
export type PayoutStatus = (typeof payoutStatuses)[number];

export const accountTypes = ['mtn_momo', 'orange_money', 'bank'] as const;
export type AccountType = (typeof accountTypes)[number];

export const ledgerTypes = [
  'contribution',
  'penalty',
  'payout',
  'platform_fee',
  'provider_fee',
  'refund',
  'guarantee_in',
  'guarantee_out',
  'adjustment',
] as const;
export type LedgerType = (typeof ledgerTypes)[number];

export const channelTypes = ['sms', 'email', 'push', 'whatsapp', 'in_app'] as const;
export type ChannelType = (typeof channelTypes)[number];

export const notificationStatuses = ['queued', 'sent', 'failed', 'read'] as const;
export type NotificationStatus = (typeof notificationStatuses)[number];

export const disputeStatuses = ['open', 'in_review', 'resolved', 'rejected'] as const;
export type DisputeStatus = (typeof disputeStatuses)[number];

export const inviteStatuses = ['pending', 'accepted', 'expired', 'revoked'] as const;
export type InviteStatus = (typeof inviteStatuses)[number];

/** Devise de la plateforme : franc CFA. */
export const CURRENCY = 'XAF' as const;
export type Currency = typeof CURRENCY;

/** Tous les montants sont des entiers, exprimés en XAF (pas de centimes). */
export type Amount = number;

/** Réponse d'erreur normalisée par `AllExceptionsFilter`. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/** Enveloppe de pagination renvoyée par les endpoints de liste. */
export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  uptime: number;
  timestamp: string;
}

/** Formate un montant entier XAF pour l'affichage (séparateur d'espace, sans décimale). */
export function formatAmount(amount: Amount): string {
  return `${new Intl.NumberFormat('fr-CM', { maximumFractionDigits: 0 }).format(amount)} FCFA`;
}
