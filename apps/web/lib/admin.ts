import { apiFetch } from './api';

export interface Page<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}

export interface AdminStats {
  users_total: number;
  users_active: number;
  kyc_pending: number;
  groups_total: number;
  groups_active: number;
  escrow_total: number;
  guarantee_total: number;
  disputes_open: number;
  reconciliation_mismatches: number;
}

export interface AdminGroup {
  id: string;
  name: string;
  status: string;
  contribution_amount: number;
  currency: string;
  frequency: string;
  members_count: number;
  rounds_count: number;
  escrow_balance: number;
  guarantee_balance: number;
  president_name: string | null;
  president_phone: string | null;
  created_at: string;
}

export interface AdminUser {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  platform_role: 'user' | 'super_admin';
  status: string;
  kyc: 'none' | 'submitted' | 'verified' | 'rejected';
  id_document_url: string | null;
  groups_count: number;
  payments_count: number;
  created_at: string;
}

export interface Setting {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_phone: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  metadata: unknown;
  ip: string | null;
  created_at: string;
}

export interface Dispute {
  id: string;
  group_id: string;
  group_name: string | null;
  round_id: string | null;
  payment_id: string | null;
  opened_by: string;
  opened_by_name: string | null;
  opener_phone: string | null;
  subject: string;
  description: string;
  attachments: string[];
  status: 'open' | 'in_review' | 'resolved' | 'rejected';
  resolution: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

export const adminApi = {
  stats: () => apiFetch<AdminStats>('/admin/stats'),
  groups: (params: { search?: string; status?: string; page?: number; page_size?: number } = {}) =>
    apiFetch<Page<AdminGroup>>(`/admin/groups${query(params)}`),
  users: (
    params: {
      search?: string;
      kyc?: string;
      status?: string;
      page?: number;
      page_size?: number;
    } = {},
  ) => apiFetch<Page<AdminUser>>(`/admin/users${query(params)}`),
  decideKyc: (userId: string, decision: 'verified' | 'rejected', reason?: string) =>
    apiFetch<{ id: string; kyc: string }>(`/admin/users/${userId}/kyc`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
    }),
  settings: () => apiFetch<Setting[]>('/admin/settings'),
  updateSettings: (settings: { key: string; value: unknown }[]) =>
    apiFetch<Setting[]>('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({ settings }),
    }),
  auditLogs: (
    params: {
      actor_id?: string;
      action?: string;
      entity?: string;
      from?: string;
      to?: string;
      page?: number;
      page_size?: number;
    } = {},
  ) => apiFetch<Page<AuditLog>>(`/admin/audit-logs${query(params)}`),
  cancelRound: (roundId: string, reason: string) =>
    apiFetch<{
      id: string;
      status: string;
      refunded_contributions: number;
      refunded_amount: number;
    }>(`/admin/rounds/${roundId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

export const disputesApi = {
  list: (params: { status?: string; page?: number; page_size?: number } = {}) =>
    apiFetch<Page<Dispute>>(`/disputes${query(params)}`),
  create: (input: {
    group_id: string;
    round_id?: string;
    payment_id?: string;
    subject: string;
    description: string;
    attachments: string[];
  }) => apiFetch<Dispute>('/disputes', { method: 'POST', body: JSON.stringify(input) }),
  update: (disputeId: string, input: { status: string; resolution?: string }) =>
    apiFetch<Dispute>(`/disputes/${disputeId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
