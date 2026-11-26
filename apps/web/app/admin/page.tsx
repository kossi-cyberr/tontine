'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { AdminDisputes } from '../../components/admin-disputes';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';
import { apiFetch, ApiError, type Profile } from '../../lib/api';
import { formatXaf } from '../../lib/groups';
import {
  adminApi,
  type AdminGroup,
  type AdminStats,
  type AdminUser,
  type AuditLog,
  type Setting,
} from '../../lib/admin';

const TABS = [
  { id: 'overview', label: 'Vue d’ensemble' },
  { id: 'kyc', label: 'KYC' },
  { id: 'groups', label: 'Groupes' },
  { id: 'disputes', label: 'Litiges' },
  { id: 'audit', label: 'Audit' },
  { id: 'settings', label: 'Paramètres' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AdminPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Profile>('/me')
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Profil indisponible.'));
  }, []);

  if (error) {
    return (
      <AppShell title="Administration" hideCreate>
        <Alert tone="error">{error}</Alert>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell title="Administration" hideCreate>
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (profile.platform_role !== 'super_admin') {
    return (
      <AppShell title="Administration" hideCreate>
        <Alert tone="error">Cet espace est réservé au Super Admin.</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell title="Administration" subtitle="Supervision de la plateforme" hideCreate>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
              tab === item.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-white text-slate-500 ring-1 ring-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'overview' ? <Overview /> : null}
        {tab === 'kyc' ? <KycQueue /> : null}
        {tab === 'groups' ? <GroupsPanel /> : null}
        {tab === 'disputes' ? <AdminDisputes /> : null}
        {tab === 'audit' ? <AuditPanel /> : null}
        {tab === 'settings' ? <SettingsPanel /> : null}
      </div>
    </AppShell>
  );
}

function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Indicateurs indisponibles.'),
      );
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!stats) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  const cards = [
    {
      label: 'Utilisateurs',
      value: String(stats.users_total),
      hint: `${stats.users_active} actifs`,
    },
    { label: 'KYC en attente', value: String(stats.kyc_pending), hint: 'à traiter' },
    {
      label: 'Groupes',
      value: String(stats.groups_total),
      hint: `${stats.groups_active} actifs`,
    },
    { label: 'Litiges ouverts', value: String(stats.disputes_open), hint: 'à instruire' },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((card) => (
          <Card key={card.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-black text-ink">{card.value}</p>
            <p className="text-[11px] text-slate-400">{card.hint}</p>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="text-sm font-bold text-ink">Fonds sous séquestre</h2>
        <div className="mt-2 flex items-end justify-between">
          <p className="text-xl font-black text-brand-700">{formatXaf(stats.escrow_total)}</p>
          <p className="text-xs text-slate-500">
            Garantie : <strong>{formatXaf(stats.guarantee_total)}</strong>
          </p>
        </div>
      </Card>
      {stats.reconciliation_mismatches > 0 ? (
        <Alert tone="error">
          {stats.reconciliation_mismatches} réconciliation(s) en écart à examiner dans le journal.
        </Alert>
      ) : (
        <Alert tone="success">Aucun écart de réconciliation enregistré.</Alert>
      )}
    </div>
  );
}

function KycQueue() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const result = await adminApi.users({ kyc: 'submitted', page_size: 50 });
      setUsers(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'File KYC indisponible.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function decide(user: AdminUser, decision: 'verified' | 'rejected') {
    let reason: string | undefined;
    if (decision === 'rejected') {
      reason = window.prompt('Motif du rejet (transmis à l’utilisateur) :') ?? undefined;
      if (!reason || reason.trim().length < 5) return;
    }
    setBusy(user.id);
    setError(null);
    setNotice(null);
    try {
      await adminApi.decideKyc(user.id, decision, reason);
      setNotice(`KYC de ${user.full_name} : ${decision === 'verified' ? 'validé' : 'rejeté'}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Décision impossible.');
    } finally {
      setBusy(null);
    }
  }

  if (!users) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">Dossiers KYC en attente</h2>
      {users.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Aucun dossier en attente.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {users.map((user) => (
            <li key={user.id} className="rounded-2xl border border-slate-100 p-3">
              <p className="text-sm font-semibold text-ink">{user.full_name}</p>
              <p className="text-[11px] text-slate-400">
                {user.phone} · inscrit le {new Date(user.created_at).toLocaleDateString('fr-FR')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {user.id_document_url ? (
                  <Badge tone="brand">Pièce : {user.id_document_url}</Badge>
                ) : (
                  <Badge tone="neutral">Aucune pièce</Badge>
                )}
                <Button
                  size="sm"
                  onClick={() => void decide(user, 'verified')}
                  disabled={busy !== null}
                >
                  Valider
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void decide(user, 'rejected')}
                  disabled={busy !== null}
                >
                  Rejeter
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
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

function GroupsPanel() {
  const [groups, setGroups] = useState<AdminGroup[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(value = search) {
    try {
      const result = await adminApi.groups({ search: value || undefined, page_size: 50 });
      setGroups(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Groupes indisponibles.');
    }
  }

  useEffect(() => {
    void load('');
  }, []);

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="flex gap-2"
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nom ou code d’invitation"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />
        <Button size="sm" type="submit">
          Rechercher
        </Button>
      </form>

      {!groups ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucun groupe.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {groups.map((group) => (
            <li key={group.id} className="rounded-2xl border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{group.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {group.members_count} membres · {group.rounds_count} tours ·{' '}
                    {group.president_name ?? '—'}
                  </p>
                </div>
                <Badge
                  tone={
                    group.status === 'active'
                      ? 'success'
                      : group.status === 'cancelled'
                        ? 'danger'
                        : 'neutral'
                  }
                >
                  {group.status}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                <span>Cotisation {formatXaf(group.contribution_amount)}</span>
                <span>Séquestre {formatXaf(group.escrow_balance)}</span>
                <span>Garantie {formatXaf(group.guarantee_balance)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function AuditPanel() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const result = await adminApi.auditLogs({
        action: action || undefined,
        entity: entity || undefined,
        page_size: 50,
      });
      setLogs(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Journal indisponible.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="Action (ex. payout.approve)"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />
        <input
          value={entity}
          onChange={(event) => setEntity(event.target.value)}
          placeholder="Entité"
          className="w-28 rounded-xl border border-slate-200 px-3 py-2 text-xs"
        />
        <Button size="sm" type="submit">
          Filtrer
        </Button>
      </form>

      {!logs ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : logs.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucune entrée pour ces filtres.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {logs.map((log) => (
            <li key={log.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink">{log.action}</p>
                <p className="text-[10px] text-slate-400">
                  {new Date(log.created_at).toLocaleString('fr-FR')}
                </p>
              </div>
              <p className="text-[11px] text-slate-500">
                {log.actor_name ?? 'Système'} · {log.entity}
                {log.entity_id ? ` (${log.entity_id.slice(0, 8)}…)` : ''} · IP {log.ip ?? '—'}
              </p>
              {log.metadata ? (
                <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                  {JSON.stringify(log.metadata)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function SettingsPanel() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const rows = await adminApi.settings();
      setSettings(rows);
      setDrafts(
        Object.fromEntries(rows.map((row) => [row.key, JSON.stringify(row.value, null, 2)])),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Paramètres indisponibles.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(setting: Setting) {
    setBusy(setting.key);
    setError(null);
    setNotice(null);
    const raw = drafts[setting.key] ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError(`La valeur de « ${setting.key} » n’est pas un JSON valide.`);
      setBusy(null);
      return;
    }
    try {
      await adminApi.updateSettings([{ key: setting.key, value: parsed }]);
      setNotice(`Paramètre « ${setting.key} » mis à jour.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
    } finally {
      setBusy(null);
    }
  }

  if (!settings) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">Paramètres globaux</h2>
      <p className="mt-1 text-[11px] text-slate-400">
        Valeurs JSON validées par l’API. Toute modification est auditée.
      </p>
      <ul className="mt-3 space-y-3">
        {settings.map((setting) => (
          <li key={setting.key} className="rounded-2xl border border-slate-100 p-3">
            <p className="font-mono text-[11px] font-semibold text-slate-600">{setting.key}</p>
            <textarea
              value={drafts[setting.key] ?? ''}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
              }
              rows={4}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-[11px]"
            />
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[10px] text-slate-400">
                Modifié le {new Date(setting.updated_at).toLocaleDateString('fr-FR')}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void save(setting)}
                disabled={busy !== null}
              >
                {busy === setting.key ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
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
