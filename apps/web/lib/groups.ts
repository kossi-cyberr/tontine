import { apiFetch } from './api';

export type GroupRole = 'president' | 'treasurer' | 'member' | 'observer';
export type GroupStatus =
  'draft' | 'recruiting' | 'active' | 'completed' | 'cancelled' | 'suspended';
export type MemberStatus = 'invited' | 'pending' | 'active' | 'suspended' | 'left';
export type Frequency = 'weekly' | 'biweekly' | 'monthly';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  rules_text: string | null;
  contribution_amount: number;
  currency: string;
  frequency: Frequency;
  start_date: string;
  min_members: number;
  max_members: number;
  payout_rule: 'strict' | 'flexible';
  beneficiary_pays: boolean;
  payment_deadline_days: number;
  late_fee_type: 'fixed' | 'percent';
  late_fee_value: number;
  platform_fee_type: 'fixed' | 'percent';
  platform_fee_value: number;
  order_mode: 'random' | 'manual';
  dual_approval_threshold: number | null;
  invite_code: string;
  status: GroupStatus;
  created_at: string;
  launched_at: string | null;
  members_count: number;
  my_role: GroupRole | null;
  my_rules_accepted_at?: string | null;
  my_membership_status?: MemberStatus | null;
  draw_seed?: string | null;
  drawn_at?: string | null;
}

export interface GroupMember {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  kyc: 'none' | 'submitted' | 'verified' | 'rejected';
  user_status: string;
  role: GroupRole;
  status: MemberStatus;
  position: number | null;
  shares: number;
  risk_flag: boolean;
  rules_accepted_at: string | null;
  joined_at: string | null;
}

export interface CreateGroupPayload {
  name: string;
  description?: string;
  rules_text?: string;
  contribution_amount: number;
  frequency: Frequency;
  start_date: string;
  min_members: number;
  max_members: number;
  payout_rule: 'strict' | 'flexible';
  beneficiary_pays: boolean;
  payment_deadline_days: number;
  late_fee_type: 'fixed' | 'percent';
  late_fee_value: number;
  platform_fee_type: 'fixed' | 'percent';
  platform_fee_value: number;
  order_mode: 'random' | 'manual';
  dual_approval_threshold: number | null;
}

export type RoundStatus =
  'scheduled' | 'open' | 'collecting' | 'ready' | 'paid_out' | 'failed' | 'cancelled';

export interface Round {
  id: string;
  cycle_id: string;
  group_id: string;
  round_number: number;
  status: RoundStatus;
  opens_on: string;
  due_date: string;
  payout_date: string;
  expected_amount: number;
  collected_amount: number;
  beneficiary: {
    id: string;
    user_id: string;
    full_name: string;
    phone: string;
    role: GroupRole;
    position: number | null;
  };
  contributions_count: number;
  paid_count: number;
  paid_amount: number;
  is_my_turn: boolean;
  my_contribution: {
    id: string;
    amount: number;
    penalty_amount: number;
    status: string;
  } | null;
}

export interface RoundDetail extends Round {
  contributions: {
    id: string;
    amount: number;
    penalty_amount: number;
    status: string;
    due_date: string;
    paid_at: string | null;
    member: { id: string; full_name: string; phone: string };
  }[];
}

export interface DrawResult {
  seed: string;
  drawn_at: string;
  order: (GroupMember & { position: number })[];
}

export interface GroupCycle {
  id: string;
  cycle_number: number;
  status: 'planned' | 'running' | 'completed';
  start_date: string;
  end_date: string | null;
  draw_seed: string | null;
  drawn_at: string | null;
  rounds_count: number;
  settled_rounds: number;
}

export const ROUND_STATUS_LABELS: Record<RoundStatus, string> = {
  scheduled: 'Planifié',
  open: 'Ouvert',
  collecting: 'Collecte',
  ready: 'Prêt',
  paid_out: 'Payé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

export interface ImportReport {
  created: number;
  skipped: number;
  errors: { line: number; message: string }[];
}

export const ROLE_LABELS: Record<GroupRole, string> = {
  president: 'Président',
  treasurer: 'Trésorier',
  member: 'Membre',
  observer: 'Observateur',
};

export const STATUS_LABELS: Record<GroupStatus, string> = {
  draft: 'Brouillon',
  recruiting: 'Recrutement',
  active: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
  suspended: 'Suspendu',
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  invited: 'Invité',
  pending: 'En attente',
  active: 'Actif',
  suspended: 'Suspendu',
  left: 'Parti',
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Chaque semaine',
  biweekly: 'Toutes les 2 semaines',
  monthly: 'Chaque mois',
};

export function formatXaf(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(amount)} XAF`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function isManager(group: Group | null): boolean {
  return group?.my_role === 'president';
}

export const groupsApi = {
  list: () => apiFetch<Group[]>('/groups'),
  get: (id: string) => apiFetch<Group>(`/groups/${id}`),
  create: (payload: CreateGroupPayload) =>
    apiFetch<Group>('/groups', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id: string, payload: Partial<CreateGroupPayload>) =>
    apiFetch<Group>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  join: (inviteCode: string) =>
    apiFetch<{ message: string; group_id: string }>('/groups/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: inviteCode }),
    }),
  acceptRules: (id: string) =>
    apiFetch<{ message: string; rules_accepted_at: string }>(`/groups/${id}/accept-rules`, {
      method: 'POST',
    }),
  members: (id: string) => apiFetch<GroupMember[]>(`/groups/${id}/members`),
  rounds: (id: string) => apiFetch<Round[]>(`/groups/${id}/rounds`),
  currentRound: (id: string) => apiFetch<Round | null>(`/groups/${id}/rounds/current`),
  round: (roundId: string) => apiFetch<RoundDetail>(`/rounds/${roundId}`),
  draw: (id: string) => apiFetch<DrawResult>(`/groups/${id}/draw`, { method: 'POST' }),
  setOrder: (id: string, memberIds: string[]) =>
    apiFetch<{ message: string; order: GroupMember[] }>(`/groups/${id}/order`, {
      method: 'PUT',
      body: JSON.stringify({ member_ids: memberIds }),
    }),
  launch: (id: string) =>
    apiFetch<{ message: string; rounds_count: number; expected_amount: number; rounds: Round[] }>(
      `/groups/${id}/launch`,
      { method: 'POST' },
    ),
  cycles: (id: string) => apiFetch<GroupCycle[]>(`/groups/${id}/cycles`),
  closeCycle: (id: string) =>
    apiFetch<{ message: string; cycle: GroupCycle; open_debts: number; next_cycle_number: number }>(
      `/groups/${id}/cycles/close`,
      { method: 'POST' },
    ),
  openNextCycle: (id: string, payload: { start_date?: string; redraw?: boolean } = {}) =>
    apiFetch<{
      message: string;
      cycle: GroupCycle;
      expected_amount: number;
      order: (GroupMember & { position: number })[];
      rounds: Round[];
    }>(`/groups/${id}/cycles`, { method: 'POST', body: JSON.stringify(payload) }),
  addMember: (
    id: string,
    payload: { full_name: string; phone: string; email?: string; role: GroupRole },
  ) =>
    apiFetch<{ member: GroupMember; activation_sent: boolean }>(`/groups/${id}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approve: (id: string, memberId: string) =>
    apiFetch<GroupMember>(`/groups/${id}/members/${memberId}/approve`, { method: 'POST' }),
  changeRole: (id: string, memberId: string, role: GroupRole) =>
    apiFetch<GroupMember>(`/groups/${id}/members/${memberId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  suspend: (id: string, memberId: string) =>
    apiFetch<GroupMember>(`/groups/${id}/members/${memberId}/suspend`, { method: 'POST' }),
  importCsv: (id: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return apiFetch<ImportReport>(`/groups/${id}/members/import`, { method: 'POST', body });
  },
};
