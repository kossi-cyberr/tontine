import { apiDownload, apiFetch } from './api';

export interface MemberDashboard {
  groups_count: number;
  total_paid: number;
  payments_count: number;
  next_payment: {
    group_id: string;
    group_name: string;
    round_id: string;
    round_number: number;
    amount: number;
    due_date: string;
    status: string;
  } | null;
  upcoming_turns: {
    group_id: string;
    group_name: string;
    round_id: string;
    round_number: number;
    payout_date: string;
    expected_amount: number;
    collected_amount: number;
  }[];
}

export interface GroupDashboard {
  group: {
    id: string;
    name: string;
    status: string;
    contribution_amount: number;
    frequency: string;
  };
  my_member: { id: string; role: string; position: number | null } | null;
  current_round: {
    id: string;
    round_number: number;
    status: string;
    due_date: string | null;
    payout_date: string | null;
    expected_amount: number;
    collected_amount: number;
    paid_count: number;
    contributions_count: number;
    beneficiary: { id: string; full_name: string; is_me: boolean };
  } | null;
  my_contribution: {
    id: string;
    amount: number;
    penalty_amount: number;
    status: string;
    due_date: string | null;
  } | null;
  stats: {
    payment_rate: number;
    paid_count: number;
    total_contributions: number;
    late_count: number;
    unpaid_count: number;
    escrow_balance: number;
    guarantee_balance: number;
    next_payout: {
      round_number: number;
      beneficiary_name: string;
      payout_date: string | null;
      amount: number;
      collected_amount: number;
    } | null;
  };
  members_at_risk: {
    id: string;
    full_name: string;
    phone: string;
    late_count: number;
    unpaid: number;
  }[];
}

export const dashboardApi = {
  me: () => apiFetch<MemberDashboard>('/me/dashboard'),
  group: (groupId: string) => apiFetch<GroupDashboard>(`/groups/${groupId}/dashboard`),
  remind: (groupId: string) =>
    apiFetch<{ sent: number; message: string }>(`/groups/${groupId}/reminders`, {
      method: 'POST',
    }),
  async downloadStatement(groupId: string): Promise<void> {
    const blob = await apiDownload(`/groups/${groupId}/statement.csv`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `releve-${groupId.slice(0, 8)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
};
