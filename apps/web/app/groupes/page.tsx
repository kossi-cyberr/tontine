'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { Badge, Button, EmptyState, Spinner } from '../../components/ui';
import { PlusIcon, UsersIcon } from '../../components/icons';
import { apiFetch, ApiError, type Profile } from '../../lib/api';
import { clearSession, isAuthenticated } from '../../lib/session';
import { adminApi, type AdminGroup } from '../../lib/admin';
import {
  FREQUENCY_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  formatDate,
  formatXaf,
  groupsApi,
  type Group,
} from '../../lib/groups';
import { dashboardApi, type MemberDashboard } from '../../lib/dashboard';

const STATUS_TONE = {
  draft: 'neutral',
  recruiting: 'brand',
  active: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  suspended: 'warning',
} as const;

export default function GroupesPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [adminGroups, setAdminGroups] = useState<AdminGroup[] | null>(null);
  const [adminSearch, setAdminSearch] = useState('');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [dashboard, setDashboard] = useState<MemberDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/connexion');
      return;
    }

    apiFetch<Profile>('/me')
      .then((profile) => {
        if (profile.platform_role === 'super_admin') {
          setIsAdmin(true);
          void dashboardApi
            .me()
            .then(setDashboard)
            .catch(() => setDashboard(null));
          groupsApi
            .list()
            .then(setGroups)
            .catch(() => setGroups([]));
          loadAdminGroups('');
          return;
        }

        setIsAdmin(false);
        void dashboardApi
          .me()
          .then(setDashboard)
          .catch(() => setDashboard(null));
        groupsApi
          .list()
          .then(setGroups)
          .catch((err) => {
            if (err instanceof ApiError && err.status === 401) {
              clearSession();
              router.replace('/connexion');
              return;
            }
            setError(err instanceof ApiError ? err.message : 'Impossible de charger vos groupes.');
            setGroups([]);
          });
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearSession();
          router.replace('/connexion');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Profil indisponible.');
        setIsAdmin(false);
        setGroups([]);
      });
  }, [router]);

  function loadAdminGroups(search: string) {
    setError(null);
    setAdminGroups(null);
    adminApi
      .groups({ search: search || undefined, page_size: 100 })
      .then((result) => setAdminGroups(result.items))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Groupes indisponibles.');
        setAdminGroups([]);
      });
  }

  if (isAdmin) {
    return (
      <AppShell
        title="Tous les groupes"
        subtitle="Supervision de la plateforme"
        hideCreate
        action={
          <a
            href="/admin"
            className="inline-flex items-center rounded-full bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200"
          >
            Administration
          </a>
        }
      >
        {groups && groups.length > 0 ? (
          <div className="mt-4 rounded-3xl border border-white/70 bg-white/90 p-4 shadow-card">
            <h2 className="text-sm font-bold text-ink">Mes groupes</h2>
            <ul className="mt-2 space-y-1.5">
              {groups.map((group) => (
                <li key={group.id}>
                  <a
                    href={`/groupes/${group.id}`}
                    className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700 transition hover:bg-brand-50 hover:text-brand-800"
                  >
                    <span className="truncate font-medium">{group.name}</span>
                    {group.my_role ? (
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {ROLE_LABELS[group.my_role]}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <h2 className="mt-6 text-sm font-bold text-ink">Tous les groupes</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            loadAdminGroups(adminSearch);
          }}
          className="mt-2 flex gap-2"
        >
          <input
            value={adminSearch}
            onChange={(event) => setAdminSearch(event.target.value)}
            placeholder="Nom ou code d’invitation"
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
          />
          <Button size="sm" type="submit">
            Rechercher
          </Button>
        </form>

        {error ? (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {adminGroups === null ? (
          <div className="mt-16 flex justify-center">
            <Spinner />
          </div>
        ) : adminGroups.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Aucun groupe sur la plateforme"
              description="Les groupes créés par les utilisateurs apparaîtront ici."
            />
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {adminGroups.map((group) => (
              <li key={group.id}>
                <a
                  href={`/groupes/${group.id}`}
                  className="group block rounded-3xl border border-white/70 bg-white/90 p-5 shadow-card backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-bold tracking-tight text-ink">
                          {group.name}
                        </h2>
                        <Badge tone={group.status === 'active' ? 'success' : 'neutral'}>
                          {STATUS_LABELS[group.status as Group['status']] ?? group.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {group.members_count} membres · {group.rounds_count} tours · président{' '}
                        {group.president_name ?? '—'}
                      </p>
                    </div>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                      <UsersIcon className="h-5 w-5" />
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Cotisation
                      </p>
                      <p className="text-lg font-black tracking-tight text-ink">
                        {formatXaf(group.contribution_amount)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>
                        Séquestre{' '}
                        <strong className="text-ink">{formatXaf(group.escrow_balance)}</strong>
                      </p>
                      <p>
                        Garantie{' '}
                        <strong className="text-ink">{formatXaf(group.guarantee_balance)}</strong>
                      </p>
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </AppShell>
    );
  }

  if (isAdmin === null) {
    return (
      <AppShell title="Mes groupes" hideCreate>
        <div className="mt-16 flex justify-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Mes groupes"
      subtitle="Vos tontines, leurs membres et les tours à venir."
      action={
        <a
          href="/groupes/nouveau"
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-gradient px-4 py-2.5 text-xs font-semibold text-white shadow-float transition active:scale-95"
        >
          <PlusIcon className="h-4 w-4" />
          Créer
        </a>
      }
    >
      {dashboard?.next_payment ? (
        <a
          href={`/groupes/${dashboard.next_payment.group_id}`}
          className="mt-4 block overflow-hidden rounded-3xl bg-brand-gradient p-5 text-white shadow-float"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100/80">
            Ma prochaine cotisation
          </p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-black tracking-tight">
                {dashboard.next_payment.group_name}
              </p>
              <p className="text-[11px] text-emerald-50/85">
                Tour {dashboard.next_payment.round_number} · échéance{' '}
                {formatDate(dashboard.next_payment.due_date)}
              </p>
            </div>
            <p className="shrink-0 text-xl font-black">
              {formatXaf(dashboard.next_payment.amount)}
            </p>
          </div>
        </a>
      ) : null}

      {dashboard && dashboard.upcoming_turns.length > 0 ? (
        <div className="mt-3 rounded-3xl border border-white/70 bg-white/80 px-4 py-3 shadow-card">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-700">
            Mes prochains tours
          </p>
          <ul className="mt-2 space-y-1.5">
            {dashboard.upcoming_turns.map((turn) => (
              <li
                key={turn.round_id}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="truncate text-slate-600">
                  {turn.group_name} · tour {turn.round_number}
                </span>
                <span className="shrink-0 font-semibold text-ink">
                  {formatDate(turn.payout_date)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <a
          href="/groupes/rejoindre"
          className="flex-1 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-center text-xs font-semibold text-slate-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
        >
          Rejoindre avec un code
        </a>
        <a
          href="/groupes/nouveau"
          className="flex-1 rounded-2xl border border-brand-200 bg-brand-50/80 px-4 py-3 text-center text-xs font-semibold text-brand-800 transition hover:bg-brand-100"
        >
          Nouvelle tontine
        </a>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {groups === null ? (
        <div className="mt-16 flex justify-center">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Aucun groupe pour l’instant"
            description="Créez votre première tontine ou rejoignez un groupe avec le code partagé par son président."
            action={
              <a
                href="/groupes/nouveau"
                className="inline-flex items-center gap-2 rounded-2xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white shadow-float"
              >
                <PlusIcon className="h-4 w-4" />
                Créer un groupe
              </a>
            }
          />
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {groups.map((group) => {
            const progress = Math.min(
              100,
              Math.round((group.members_count / group.max_members) * 100),
            );
            const tone = STATUS_TONE[group.status] ?? 'neutral';
            return (
              <li key={group.id}>
                <a
                  href={`/groupes/${group.id}`}
                  className="group block overflow-hidden rounded-3xl border border-white/70 bg-white/90 p-5 shadow-card backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-bold tracking-tight text-ink">
                          {group.name}
                        </h2>
                        <Badge tone={tone}>{STATUS_LABELS[group.status]}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                        {group.description ??
                          `${FREQUENCY_LABELS[group.frequency]} · début ${group.start_date}`}
                      </p>
                    </div>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700 transition group-hover:bg-brand-100">
                      <UsersIcon className="h-5 w-5" />
                    </span>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        Cotisation
                      </p>
                      <p className="text-lg font-black tracking-tight text-ink">
                        {formatXaf(group.contribution_amount)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {FREQUENCY_LABELS[group.frequency]}
                      </p>
                    </div>
                    <div className="text-right">
                      {group.my_role ? (
                        <Badge tone={group.my_role === 'president' ? 'warning' : 'neutral'}>
                          {ROLE_LABELS[group.my_role]}
                        </Badge>
                      ) : null}
                      <p className="mt-2 text-xs font-semibold text-slate-600">
                        {group.members_count}/{group.max_members} membres
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand-gradient transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
