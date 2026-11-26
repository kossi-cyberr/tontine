'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from './ui';
import { ChartIcon, DownloadIcon } from './icons';
import { ApiError } from '../lib/api';
import { formatDate, formatXaf } from '../lib/groups';
import { dashboardApi, type GroupDashboard } from '../lib/dashboard';

const CONTRIBUTION_LABELS: Record<string, string> = {
  pending: 'À payer',
  late: 'En retard',
  paid: 'Payée',
  waived: 'Dispensée',
  refunded: 'Remboursée',
  failed: 'Échec',
};

export function GroupDashboardPanel({
  groupId,
  canManage,
  refreshKey = 0,
}: {
  groupId: string;
  canManage: boolean;
  refreshKey?: number;
}) {
  const [data, setData] = useState<GroupDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    dashboardApi
      .group(groupId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Tableau de bord indisponible.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey]);

  async function remind() {
    setBusy('remind');
    setError(null);
    setNotice(null);
    try {
      const result = await dashboardApi.remind(groupId);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Relance impossible.');
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy('export');
    setError(null);
    try {
      await dashboardApi.downloadStatement(groupId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export impossible.');
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <Card>
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </Card>
    );
  }

  const { stats, my_member, my_contribution, current_round } = data;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-brand-700">
          <ChartIcon className="h-4 w-4" />
          <h2 className="text-sm font-bold text-ink">Tableau de bord</h2>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:text-brand-700 disabled:opacity-60"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {busy === 'export' ? 'Export…' : 'Relevé CSV'}
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-2xl bg-brand-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-brand-600">Taux de paiement</p>
          <p className="mt-0.5 text-lg font-black text-brand-800">{stats.payment_rate}%</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Retards</p>
          <p className="mt-0.5 text-lg font-black text-slate-800">{stats.late_count}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Séquestre</p>
          <p className="mt-0.5 font-bold text-slate-800">{formatXaf(stats.escrow_balance)}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Garantie</p>
          <p className="mt-0.5 font-bold text-slate-800">{formatXaf(stats.guarantee_balance)}</p>
        </div>
      </div>

      {stats.next_payout ? (
        <div className="mt-3 rounded-2xl bg-slate-900 px-4 py-3 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Prochain décaissement
          </p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{stats.next_payout.beneficiary_name}</p>
              <p className="text-[11px] text-slate-300">
                Tour {stats.next_payout.round_number} · {formatDate(stats.next_payout.payout_date)}
              </p>
            </div>
            <p className="text-right text-sm font-black text-emerald-300">
              {formatXaf(stats.next_payout.amount)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {my_member ? <Badge tone="brand">Mon rang : {my_member.position ?? '—'}</Badge> : null}
        {my_contribution ? (
          <Badge
            tone={
              my_contribution.status === 'paid'
                ? 'success'
                : my_contribution.status === 'late'
                  ? 'danger'
                  : 'warning'
            }
          >
            Ma cotisation : {CONTRIBUTION_LABELS[my_contribution.status] ?? my_contribution.status}
          </Badge>
        ) : current_round ? (
          <Badge tone="success">Pas de cotisation attendue ce tour</Badge>
        ) : null}
        {my_contribution && my_contribution.penalty_amount > 0 ? (
          <Badge tone="danger">Pénalité : {formatXaf(my_contribution.penalty_amount)}</Badge>
        ) : null}
      </div>

      {canManage && stats.unpaid_count > 0 ? (
        <div className="mt-3 space-y-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void remind()}
            disabled={busy !== null}
            className="w-full"
          >
            {busy === 'remind'
              ? 'Envoi des relances…'
              : `Relancer les ${stats.unpaid_count} non-payeurs`}
          </Button>
          {stats.late_count >= 2 ? (
            <p className="text-center text-[10px] text-amber-700">
              {stats.late_count} cotisations en retard : envisagez une relance ou un échange avec
              les membres concernés.
            </p>
          ) : null}
        </div>
      ) : null}

      {canManage && data.members_at_risk.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-slate-500">Membres à risque</p>
          <ul className="mt-1.5 space-y-1">
            {data.members_at_risk.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between rounded-xl bg-red-50/70 px-3 py-1.5 text-[11px]"
              >
                <span className="truncate font-medium text-red-800">{member.full_name}</span>
                <span className="shrink-0 text-red-600">{member.late_count} retard(s)</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}
    </Card>
  );
}
