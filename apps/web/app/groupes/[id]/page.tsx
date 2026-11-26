'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  SelectField,
  Spinner,
  TextareaField,
} from '../../../components/ui';
import {
  CheckIcon,
  CopyIcon,
  ShieldIcon,
  SparkIcon,
  UsersIcon,
  WalletIcon,
} from '../../../components/icons';
import { PaymentSheet } from '../../../components/payment-sheet';
import { PayoutPanel } from '../../../components/payout-panel';
import { GroupDashboardPanel } from '../../../components/group-dashboard';
import { ApiError } from '../../../lib/api';
import { clearSession, isAuthenticated } from '../../../lib/session';
import {
  LEDGER_TYPE_LABELS,
  METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  paymentsApi,
  payoutsApi,
  type Escrow,
  type LedgerEntry,
  type Payment,
  type RoundPayoutState,
} from '../../../lib/payments';
import {
  FREQUENCY_LABELS,
  MEMBER_STATUS_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  formatDate,
  formatXaf,
  groupsApi,
  isManager,
  type Frequency,
  ROUND_STATUS_LABELS,
  type Group,
  type GroupMember,
  type GroupRole,
  type ImportReport,
  type Round,
  type RoundStatus,
} from '../../../lib/groups';

type Tab = 'membres' | 'calendrier' | 'paiements' | 'regles' | 'parametres';

const ROUND_TONE: Record<RoundStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'brand'> = {
  scheduled: 'neutral',
  open: 'brand',
  collecting: 'brand',
  ready: 'warning',
  paid_out: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const MEMBER_TONE = {
  active: 'success',
  pending: 'warning',
  invited: 'brand',
  suspended: 'danger',
  left: 'neutral',
} as const;

const GROUP_TONE = {
  draft: 'neutral',
  recruiting: 'brand',
  active: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  suspended: 'warning',
} as const;

export default function GroupeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [drawSeed, setDrawSeed] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [tab, setTab] = useState<Tab>('membres');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [escrow, setEscrow] = useState<Escrow | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [myPayments, setMyPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<string | null>(null);
  const [payoutState, setPayoutState] = useState<RoundPayoutState | null>(null);

  const [addForm, setAddForm] = useState({
    full_name: '',
    phone: '+237',
    email: '',
    role: 'member' as GroupRole,
  });
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const [settings, setSettings] = useState({
    name: '',
    description: '',
    rules_text: '',
    contribution_amount: 0,
    frequency: 'monthly' as Frequency,
    start_date: '',
    min_members: 10,
    max_members: 100,
    payout_rule: 'flexible' as 'strict' | 'flexible',
    order_mode: 'random' as 'random' | 'manual',
    beneficiary_pays: true,
    payment_deadline_days: 2,
  });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [groupData, memberData, roundData, currentData] = await Promise.all([
        groupsApi.get(groupId),
        groupsApi.members(groupId),
        groupsApi.rounds(groupId),
        groupsApi.currentRound(groupId),
      ]);
      setGroup(groupData);
      setMembers(memberData);
      setRounds(roundData);
      setCurrentRound(currentData);
      setDrawSeed(groupData.draw_seed ?? null);
      setSettings({
        name: groupData.name,
        description: groupData.description ?? '',
        rules_text: groupData.rules_text ?? '',
        contribution_amount: groupData.contribution_amount,
        frequency: groupData.frequency,
        start_date: groupData.start_date,
        min_members: groupData.min_members,
        max_members: groupData.max_members,
        payout_rule: groupData.payout_rule,
        order_mode: groupData.order_mode,
        beneficiary_pays: groupData.beneficiary_pays,
        payment_deadline_days: groupData.payment_deadline_days,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        router.replace('/connexion');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Impossible de charger ce groupe.');
    } finally {
      setLoading(false);
    }
  }, [groupId, router]);

  const currentRoundId = currentRound?.id ?? null;

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    setPaymentsError(null);
    try {
      const [escrowData, ledgerData, paymentData, payoutData] = await Promise.all([
        paymentsApi.escrow(groupId),
        paymentsApi.ledger(groupId),
        paymentsApi.listMine(),
        currentRoundId ? payoutsApi.forRound(currentRoundId) : Promise.resolve(null),
      ]);
      setEscrow(escrowData);
      setLedger(ledgerData);
      setMyPayments(paymentData);
      setPayoutState(payoutData);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        router.replace('/connexion');
        return;
      }
      setPaymentsError(
        err instanceof ApiError ? err.message : 'Impossible de charger les paiements.',
      );
    } finally {
      setPaymentsLoading(false);
    }
  }, [groupId, router, currentRoundId]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/connexion');
      return;
    }
    void load();
  }, [load, router]);

  useEffect(() => {
    if (tab === 'paiements') void loadPayments();
  }, [tab, loadPayments]);

  function refreshAfterPayment() {
    void load();
    if (tab === 'paiements') void loadPayments();
  }

  async function downloadReceipt(paymentId: string) {
    setReceiptBusy(paymentId);
    setPaymentsError(null);
    try {
      await paymentsApi.downloadReceipt(paymentId);
    } catch (err) {
      setPaymentsError(err instanceof ApiError ? err.message : 'Reçu indisponible.');
    } finally {
      setReceiptBusy(null);
    }
  }

  const manager = isManager(group);
  const locked = Boolean(group?.launched_at);
  const pending = useMemo(() => members.filter((member) => member.status === 'pending'), [members]);
  const activeMembers = useMemo(
    () => members.filter((member) => member.status !== 'pending'),
    [members],
  );
  const orderedMembers = useMemo(
    () =>
      members
        .filter((member) => member.status === 'active' && member.position !== null)
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    [members],
  );
  const activeCount = members.filter((member) => member.status === 'active').length;

  async function copyCode() {
    if (!group) return;
    try {
      await navigator.clipboard.writeText(group.invite_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function addMember() {
    if (!group) return;
    setAddLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await groupsApi.addMember(group.id, {
        full_name: addForm.full_name,
        phone: addForm.phone,
        ...(addForm.email ? { email: addForm.email } : {}),
        role: addForm.role,
      });
      setNotice(
        result.activation_sent
          ? `Membre ajouté. Un lien d’activation a été préparé pour ${result.member.full_name}.`
          : `Membre ajouté : ${result.member.full_name}.`,
      );
      setAddForm({ full_name: '', phone: '+237', email: '', role: 'member' });
      setAddOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ajout impossible.');
    } finally {
      setAddLoading(false);
    }
  }

  async function approve(member: GroupMember) {
    setBusyId(member.id);
    setError(null);
    try {
      await groupsApi.approve(groupId, member.id);
      setNotice(`${member.full_name} a été validé.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Validation impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(member: GroupMember, role: GroupRole) {
    setBusyId(member.id);
    setError(null);
    try {
      await groupsApi.changeRole(groupId, member.id, role);
      setNotice(`Rôle de ${member.full_name} mis à jour.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Changement de rôle impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function suspend(member: GroupMember) {
    if (!window.confirm(`Suspendre ${member.full_name} ? Il perdra l’accès au groupe.`)) return;
    setBusyId(member.id);
    setError(null);
    try {
      await groupsApi.suspend(groupId, member.id);
      setNotice(`${member.full_name} a été suspendu.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suspension impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function importCsv(file: File) {
    setImporting(true);
    setError(null);
    setReport(null);
    try {
      const result = await groupsApi.importCsv(groupId, file);
      setReport(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import impossible.');
    } finally {
      setImporting(false);
    }
  }

  async function acceptRules() {
    try {
      await groupsApi.acceptRules(groupId);
      setNotice('Règlement accepté.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Acceptation impossible.');
    }
  }

  async function runDraw() {
    setDrawing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await groupsApi.draw(groupId);
      setDrawSeed(result.seed);
      setNotice('Tirage effectué. La graine est affichée pour vérification.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tirage impossible.');
    } finally {
      setDrawing(false);
    }
  }

  async function launchGroup() {
    if (
      !window.confirm(
        'Lancer le groupe ? Le calendrier sera généré et la liste des membres ainsi que l’ordre seront verrouillés.',
      )
    ) {
      return;
    }
    setLaunching(true);
    setError(null);
    setNotice(null);
    try {
      const result = await groupsApi.launch(groupId);
      setNotice(`${result.message} ${result.rounds_count} tour(s) planifié(s).`);
      await load();
      setTab('calendrier');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lancement impossible.');
    } finally {
      setLaunching(false);
    }
  }

  async function saveSettings() {
    if (!group) return;
    setSettingsLoading(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      await groupsApi.update(
        group.id,
        locked
          ? {
              name: settings.name,
              description: settings.description,
              rules_text: settings.rules_text,
            }
          : {
              name: settings.name,
              description: settings.description,
              rules_text: settings.rules_text,
              contribution_amount: settings.contribution_amount,
              frequency: settings.frequency,
              start_date: settings.start_date,
              min_members: settings.min_members,
              max_members: settings.max_members,
              payout_rule: settings.payout_rule,
              order_mode: settings.order_mode,
              beneficiary_pays: settings.beneficiary_pays,
              payment_deadline_days: settings.payment_deadline_days,
            },
      );
      setSettingsMessage('Paramètres enregistrés.');
      await load();
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
    } finally {
      setSettingsLoading(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="mt-20 flex justify-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (!group) {
    return (
      <AppShell>
        <div className="mt-8">
          <EmptyState
            title="Groupe indisponible"
            description={error ?? 'Vous n’avez pas accès à ce groupe.'}
            action={
              <a
                href="/groupes"
                className="rounded-2xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white"
              >
                Retour à mes groupes
              </a>
            }
          />
        </div>
      </AppShell>
    );
  }

  const progress = Math.min(100, Math.round((group.members_count / group.max_members) * 100));

  return (
    <AppShell
      action={
        <a
          href="/groupes"
          className="rounded-full bg-white/80 px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/80"
        >
          Mes groupes
        </a>
      }
    >
      <section className="relative overflow-hidden rounded-4xl bg-brand-gradient p-6 text-white shadow-float animate-fade-up">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-white/10 blur-2xl"
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={GROUP_TONE[group.status]}>{STATUS_LABELS[group.status]}</Badge>
              {group.my_role ? (
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide">
                  {ROLE_LABELS[group.my_role]}
                </span>
              ) : null}
            </div>
            <h1 className="mt-3 truncate text-3xl font-black tracking-tight">{group.name}</h1>
            {group.description ? (
              <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-emerald-50/90">
                {group.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-100/80">
              Cotisation
            </p>
            <p className="mt-1 text-base font-black">{formatXaf(group.contribution_amount)}</p>
            <p className="text-[11px] text-emerald-50/80">{FREQUENCY_LABELS[group.frequency]}</p>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-100/80">
              Membres
            </p>
            <p className="mt-1 text-base font-black">
              {group.members_count}
              <span className="text-sm font-semibold text-emerald-100/80">
                {' '}
                / {group.max_members}
              </span>
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="col-span-2 rounded-2xl bg-white/10 px-4 py-3 backdrop-blur sm:col-span-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-100/80">
              Début
            </p>
            <p className="mt-1 text-base font-black">{formatDate(group.start_date)}</p>
            <p className="text-[11px] text-emerald-50/80">
              {group.order_mode === 'random' ? 'Ordre aléatoire' : 'Ordre manuel'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-2 rounded-2xl bg-white/15 px-3.5 py-2 text-xs font-semibold backdrop-blur transition hover:bg-white/25"
          >
            {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
            Code : <span className="tracking-[0.2em]">{group.invite_code}</span>
          </button>
          <a
            href={`/groupes/rejoindre`}
            className="inline-flex items-center gap-1.5 rounded-2xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-emerald-50 ring-1 ring-white/25"
          >
            Partager
          </a>
        </div>
      </section>

      {locked ? (
        <p className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          <ShieldIcon className="h-4 w-4 shrink-0" />
          Groupe lancé le {formatDate(group.launched_at)} : les règles financières sont figées.
        </p>
      ) : null}

      {group.launched_at && currentRound ? (
        <section className="mt-4 overflow-hidden rounded-3xl border border-white/70 bg-white shadow-card">
          <div className="flex items-start justify-between gap-3 bg-brand-gradient px-5 py-4 text-white">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100/80">
                Qui reçoit ce tour ?
              </p>
              <p className="mt-1 text-xl font-black tracking-tight">
                {currentRound.beneficiary.full_name}
              </p>
              <p className="text-xs text-emerald-50/85">
                Tour {currentRound.round_number} · décaissement le{' '}
                {formatDate(currentRound.payout_date)}
              </p>
            </div>
            <div className="text-right">
              {currentRound.is_my_turn ? (
                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-800">
                  Mon tour
                </span>
              ) : (
                <Badge tone={ROUND_TONE[currentRound.status]}>
                  {ROUND_STATUS_LABELS[currentRound.status]}
                </Badge>
              )}
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Montant du tour
                </p>
                <p className="text-2xl font-black tracking-tight text-ink">
                  {formatXaf(currentRound.expected_amount)}
                </p>
              </div>
              <p className="text-xs font-semibold text-slate-500">
                {currentRound.paid_count}/{currentRound.contributions_count} cotisations
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-gradient transition-all duration-700"
                style={{
                  width: `${
                    currentRound.contributions_count
                      ? Math.round(
                          (currentRound.paid_count / currentRound.contributions_count) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
              <span>Échéance : {formatDate(currentRound.due_date)}</span>
              <span className="font-semibold text-slate-700">
                Collecté : {formatXaf(currentRound.collected_amount)}
              </span>
            </div>

            {currentRound.my_contribution ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                {['paid', 'waived', 'refunded'].includes(currentRound.my_contribution.status) ? (
                  <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700">
                    <CheckIcon className="h-4 w-4 shrink-0" />
                    Ma cotisation de ce tour est réglée.
                  </div>
                ) : ['open', 'collecting'].includes(currentRound.status) ? (
                  <div className="space-y-2">
                    <PaymentSheet
                      contributionId={currentRound.my_contribution.id}
                      amount={currentRound.my_contribution.amount}
                      penalty={currentRound.my_contribution.penalty_amount}
                      onPaid={refreshAfterPayment}
                    />
                    <p className="text-center text-[10px] text-slate-500">
                      Ma part : {formatXaf(currentRound.my_contribution.amount)}
                      {currentRound.my_contribution.penalty_amount > 0
                        ? ` + pénalité ${formatXaf(currentRound.my_contribution.penalty_amount)}`
                        : ''}
                    </p>
                  </div>
                ) : currentRound.status === 'ready' ? (
                  <p className="rounded-2xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    Collecte terminée. Le décaissement du tour est en préparation.
                  </p>
                ) : (
                  <p className="rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                    Les paiements seront ouverts le {formatDate(currentRound.opens_on)}.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {group.launched_at ? (
        <div className="mt-4">
          <GroupDashboardPanel
            groupId={groupId}
            canManage={group.my_role === 'president' || group.my_role === 'treasurer'}
            refreshKey={currentRound?.collected_amount ?? 0}
          />
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

      <div className="mt-5 grid grid-cols-5 gap-1 rounded-2xl bg-white/80 p-1.5 shadow-sm ring-1 ring-slate-200/70">
        {(
          [
            ['membres', 'Membres'],
            ['calendrier', 'Tours'],
            ['paiements', 'Payer'],
            ['regles', 'Règles'],
            ['parametres', 'Réglages'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`rounded-xl px-1.5 py-2.5 text-[11px] font-semibold transition ${
              tab === value ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'membres' ? (
        <div className="mt-4 space-y-4">
          {manager && pending.length > 0 ? (
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-ink">Demandes en attente</h2>
                <Badge tone="warning">{pending.length}</Badge>
              </div>
              <ul className="mt-3 space-y-2">
                {pending.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50/70 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{member.full_name}</p>
                      <p className="text-xs text-slate-500">{member.phone}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => approve(member)}
                      disabled={busyId === member.id}
                      className="shrink-0"
                    >
                      Valider
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-ink">
              Membres <span className="font-normal text-slate-400">({members.length})</span>
            </h2>
            {manager ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAddOpen((value) => !value)}>
                  {addOpen ? 'Fermer' : 'Ajouter'}
                </Button>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-white px-3.5 py-2 text-xs font-semibold text-ink ring-1 ring-slate-200 transition hover:ring-brand-300">
                  {importing ? 'Import…' : 'CSV'}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importCsv(file);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>

          {manager && addOpen ? (
            <Card className="space-y-3">
              <h3 className="text-sm font-bold text-ink">Nouveau membre</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Nom complet"
                  value={addForm.full_name}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, full_name: event.target.value }))
                  }
                  placeholder="Nom du membre"
                />
                <Field
                  label="Téléphone"
                  value={addForm.phone}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  placeholder="+237650000000"
                />
                <Field
                  label="Email (facultatif)"
                  type="email"
                  value={addForm.email}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
                <SelectField
                  label="Rôle"
                  value={addForm.role}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, role: event.target.value as GroupRole }))
                  }
                >
                  <option value="member">Membre</option>
                  <option value="treasurer">Trésorier</option>
                  <option value="observer">Observateur</option>
                </SelectField>
              </div>
              <Button onClick={addMember} disabled={addLoading} className="w-full">
                {addLoading ? 'Ajout…' : 'Ajouter et envoyer le lien d’activation'}
              </Button>
              <p className="text-xs text-slate-500">
                Un compte en attente est créé si le numéro n’est pas encore inscrit. Le code
                d’activation est transmis par le canal SMS configuré.
              </p>
            </Card>
          ) : null}

          {report ? (
            <Card className="space-y-2">
              <h3 className="text-sm font-bold text-ink">Rapport d’import</h3>
              <p className="text-xs text-slate-600">
                {report.created} créé(s) · {report.skipped} ignoré(s) · {report.errors.length}{' '}
                erreur(s)
              </p>
              {report.errors.length > 0 ? (
                <ul className="space-y-1 text-xs text-red-700">
                  {report.errors.map((item) => (
                    <li key={`${item.line}-${item.message}`}>
                      Ligne {item.line} : {item.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {activeMembers.length === 0 ? (
            <EmptyState
              title="Pas encore de membres"
              description="Ajoutez les participants un par un ou importez un fichier CSV (full_name, phone, email)."
            />
          ) : (
            <ul className="space-y-2">
              {activeMembers.map((member) => {
                const tone = MEMBER_TONE[member.status] ?? 'neutral';
                return (
                  <li key={member.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-600">
                          {member.full_name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-semibold text-ink">
                              {member.full_name}
                            </p>
                            <Badge tone={tone}>{MEMBER_STATUS_LABELS[member.status]}</Badge>
                            {member.role !== 'member' ? (
                              <Badge tone={member.role === 'president' ? 'warning' : 'neutral'}>
                                {ROLE_LABELS[member.role]}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {member.phone}
                            {member.email ? ` · ${member.email}` : ''}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {member.joined_at
                              ? `Membre depuis ${formatDate(member.joined_at)}`
                              : 'Invitation en attente'}
                            {member.kyc === 'verified' ? ' · KYC vérifié' : ''}
                          </p>
                        </div>
                      </div>

                      {manager && member.status === 'active' ? (
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <select
                            value={member.role}
                            disabled={busyId === member.id}
                            onChange={(event) =>
                              changeRole(member, event.target.value as GroupRole)
                            }
                            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600"
                          >
                            <option value="president">Président</option>
                            <option value="treasurer">Trésorier</option>
                            <option value="member">Membre</option>
                            <option value="observer">Observateur</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => suspend(member)}
                            disabled={busyId === member.id}
                            className="text-[11px] font-semibold text-red-600 hover:underline"
                          >
                            Suspendre
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'calendrier' ? (
        <div className="mt-4 space-y-4">
          {!group.launched_at ? (
            <Card className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-ink">Ordre de passage</h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Le tirage est équitable et vérifiable : la graine aléatoire est conservée et
                    permet de rejouer l’ordre. Le lancement fige l’ordre et les membres.
                  </p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                  <SparkIcon className="h-5 w-5" />
                </span>
              </div>

              {drawSeed ? (
                <div className="rounded-2xl bg-slate-900 px-4 py-3 text-white">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    Graine du tirage
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-emerald-200">
                    {drawSeed}
                  </p>
                </div>
              ) : null}

              {orderedMembers.length > 0 ? (
                <ol className="space-y-1.5">
                  {orderedMembers.map((member, index) => (
                    <li
                      key={member.id}
                      className="flex animate-fade-up items-center gap-3 rounded-2xl bg-slate-50 px-3 py-2"
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-brand-700 ring-1 ring-slate-200">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
                        {member.full_name}
                      </span>
                      {member.role !== 'member' ? (
                        <Badge tone={member.role === 'president' ? 'warning' : 'neutral'}>
                          {ROLE_LABELS[member.role]}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-500">
                  Aucun ordre défini. Lancez le tirage pour positionner les {activeCount} membres
                  actifs.
                </p>
              )}

              {manager ? (
                <div className="space-y-2">
                  <Button
                    onClick={runDraw}
                    disabled={drawing || activeCount < 2}
                    className="w-full"
                  >
                    {drawing ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Tirage en cours…
                      </>
                    ) : (
                      <>
                        <SparkIcon className="h-4 w-4" />
                        {orderedMembers.length > 0 ? 'Relancer le tirage' : 'Tirer l’ordre au sort'}
                      </>
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={launchGroup}
                    disabled={
                      launching ||
                      orderedMembers.length < group.min_members ||
                      orderedMembers.length !== activeCount
                    }
                    className="w-full"
                  >
                    {launching ? 'Lancement…' : 'Lancer le groupe'}
                  </Button>
                  <p className="text-center text-[11px] text-slate-500">
                    {activeCount < group.min_members
                      ? `Encore ${group.min_members - activeCount} membre(s) actif(s) pour atteindre le minimum.`
                      : orderedMembers.length !== activeCount
                        ? 'Tirez l’ordre de tous les membres avant de lancer.'
                        : 'Prêt à lancer : le calendrier sera généré automatiquement.'}
                  </p>
                </div>
              ) : (
                <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  Seul le président peut lancer le tirage et le groupe. Vous pourrez consulter le
                  calendrier complet après le lancement.
                </p>
              )}
            </Card>
          ) : (
            <>
              {drawSeed ? (
                <div className="rounded-2xl bg-slate-900 px-4 py-3 text-white">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    Tirage vérifiable
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-emerald-200">
                    {drawSeed}
                  </p>
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-ink">Calendrier des tours</h2>
                <Badge tone="brand">{rounds.length} tours</Badge>
              </div>

              <ol className="space-y-2">
                {rounds.map((round) => {
                  const isCurrent = currentRound?.id === round.id;
                  return (
                    <li
                      key={round.id}
                      className={`card p-4 ${round.is_my_turn ? 'ring-2 ring-brand-400/80' : ''} ${
                        isCurrent ? 'border-brand-200' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                            {round.round_number}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-sm font-semibold text-ink">
                                {round.beneficiary.full_name}
                              </p>
                              {round.is_my_turn ? <Badge tone="success">Mon tour</Badge> : null}
                            </div>
                            <p className="mt-0.5 text-xs font-semibold text-slate-600">
                              {formatXaf(round.expected_amount)} · {round.paid_count}/
                              {round.contributions_count} payées
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              Ouverture {formatDate(round.opens_on)} · échéance{' '}
                              {formatDate(round.due_date)}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              Décaissement prévu le {formatDate(round.payout_date)}
                            </p>
                            {round.my_contribution ? (
                              <p className="mt-1 text-[11px] text-slate-500">
                                Ma part : {formatXaf(round.my_contribution.amount)}
                                {round.my_contribution.penalty_amount > 0
                                  ? ` + pénalité ${formatXaf(round.my_contribution.penalty_amount)}`
                                  : ''}
                                {' · '}
                                {round.my_contribution.status === 'paid'
                                  ? 'payée'
                                  : round.my_contribution.status === 'late'
                                    ? 'en retard'
                                    : 'en attente'}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <Badge tone={ROUND_TONE[round.status]}>
                          {ROUND_STATUS_LABELS[round.status]}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {rounds.length === 0 ? (
                <EmptyState
                  title="Calendrier introuvable"
                  description="Le groupe est lancé mais aucun tour n’a été trouvé. Contactez le support."
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === 'paiements' ? (
        <div className="mt-4 space-y-4">
          {paymentsError ? <Alert tone="error">{paymentsError}</Alert> : null}

          {currentRound ? (
            <PayoutPanel
              round={currentRound}
              state={payoutState}
              canManage={group?.my_role === 'president' || group?.my_role === 'treasurer'}
              onChanged={refreshAfterPayment}
            />
          ) : null}

          {paymentsLoading && !escrow ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-brand-700">
                    <WalletIcon className="h-4 w-4" />
                    <div>
                      <h2 className="text-sm font-bold text-ink">Séquestre du groupe</h2>
                      <p className="text-[11px] text-slate-500">Fonds collectés, bloqués</p>
                    </div>
                  </div>
                  <Badge tone={escrow?.consistent === false ? 'danger' : 'success'}>
                    {escrow?.consistent === false ? 'Écart détecté' : 'Équilibré'}
                  </Badge>
                </div>
                <p className="mt-3 text-3xl font-black tracking-tight text-ink">
                  {formatXaf(escrow?.balance ?? 0)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      Caisse de garantie
                    </p>
                    <p className="mt-0.5 font-bold text-slate-700">
                      {formatXaf(escrow?.guarantee_balance ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Devise</p>
                    <p className="mt-0.5 font-bold text-slate-700">{escrow?.currency ?? 'XAF'}</p>
                  </div>
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                  {escrow?.account_id === null
                    ? 'Le compte séquestre sera ouvert au lancement du groupe.'
                    : 'Chaque mouvement du grand livre est immuable et vérifiable par tous les membres.'}
                </p>
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-ink">Mes paiements</h2>
                  <Badge tone="brand">{myPayments.length}</Badge>
                </div>
                {myPayments.length === 0 ? (
                  <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                    Aucun paiement enregistré pour le moment.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {myPayments.map((payment) => (
                      <li key={payment.id} className="rounded-2xl bg-slate-50 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-ink">
                              {payment.group?.name ?? group.name}
                              {payment.round_number ? ` · Tour ${payment.round_number}` : ''}
                            </p>
                            <p className="mt-0.5 text-[10px] text-slate-500">
                              {formatDate(payment.created_at)}
                              {payment.method ? ` · ${METHOD_LABELS[payment.method]}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-bold text-ink">
                              {formatXaf(payment.amount)}
                            </p>
                            <Badge tone={PAYMENT_STATUS_TONE[payment.status]}>
                              {PAYMENT_STATUS_LABELS[payment.status]}
                            </Badge>
                          </div>
                        </div>
                        {payment.status === 'confirmed' ? (
                          <button
                            type="button"
                            onClick={() => void downloadReceipt(payment.id)}
                            disabled={receiptBusy === payment.id}
                            className="mt-2 text-[11px] font-semibold text-brand-700 underline-offset-2 hover:underline disabled:opacity-60"
                          >
                            {receiptBusy === payment.id
                              ? 'Préparation…'
                              : 'Télécharger le reçu PDF'}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-ink">Grand livre</h2>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Lecture seule
                  </span>
                </div>
                {ledger.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                    Aucun mouvement pour l’instant.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {ledger.map((entry) => {
                      const amount = entry.credit > 0 ? entry.credit : -entry.debit;
                      return (
                        <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-700">
                              {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
                            </p>
                            <p className="truncate text-[10px] text-slate-400">
                              {entry.description ?? '—'} · {formatDate(entry.created_at)}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 text-xs font-bold ${
                              amount >= 0 ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {amount >= 0 ? '+' : '−'}
                            {formatXaf(Math.abs(amount))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </>
          )}
        </div>
      ) : null}

      {tab === 'regles' ? (
        <div className="mt-4 space-y-3">
          <Card>
            <div className="flex items-center gap-2 text-brand-700">
              <UsersIcon className="h-4 w-4" />
              <h2 className="text-sm font-bold text-ink">Règlement intérieur</h2>
            </div>
            {group.rules_text ? (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                {group.rules_text}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Aucun règlement n’a encore été rédigé. Le président peut le compléter dans les
                paramètres du groupe.
              </p>
            )}

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
              {group.my_rules_accepted_at ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
                  <CheckIcon className="h-4 w-4" />
                  Accepté le {formatDate(group.my_rules_accepted_at)}
                </span>
              ) : (
                <div className="flex flex-col gap-2">
                  <span>Vous n’avez pas encore accepté ce règlement.</span>
                  <Button size="sm" onClick={acceptRules} className="self-start">
                    J’accepte le règlement
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="text-sm font-bold text-ink">Règles financières</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
              {[
                ['Cotisation', formatXaf(group.contribution_amount)],
                ['Fréquence', FREQUENCY_LABELS[group.frequency]],
                ['Bénéficiaire cotise', group.beneficiary_pays ? 'Oui' : 'Non'],
                ['Délai de paiement', `${group.payment_deadline_days} jour(s)`],
                [
                  'Pénalité de retard',
                  `${group.late_fee_value} ${group.late_fee_type === 'percent' ? '%' : 'XAF'}`,
                ],
                [
                  'Frais plateforme',
                  `${group.platform_fee_value} ${group.platform_fee_type === 'percent' ? '%' : 'XAF'}`,
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-slate-50 px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {label}
                  </dt>
                  <dd className="mt-0.5 font-semibold text-slate-700">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      ) : null}

      {tab === 'parametres' ? (
        <div className="mt-4">
          {!manager ? (
            <EmptyState
              title="Réservé au président"
              description="Seul le président du groupe peut modifier les paramètres et les règles financières."
            />
          ) : (
            <Card className="space-y-4">
              <h2 className="text-sm font-bold text-ink">Paramètres du groupe</h2>
              {settingsError ? <Alert tone="error">{settingsError}</Alert> : null}
              {settingsMessage ? <Alert tone="success">{settingsMessage}</Alert> : null}

              <Field
                label="Nom"
                value={settings.name}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, name: event.target.value }))
                }
              />
              <TextareaField
                label="Description"
                value={settings.description}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, description: event.target.value }))
                }
              />
              <TextareaField
                label="Règlement intérieur"
                value={settings.rules_text}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, rules_text: event.target.value }))
                }
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Cotisation (XAF)"
                  type="number"
                  min={1000}
                  max={5000000}
                  value={settings.contribution_amount}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      contribution_amount: Number(event.target.value),
                    }))
                  }
                />
                <SelectField
                  label="Fréquence"
                  value={settings.frequency}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      frequency: event.target.value as Frequency,
                    }))
                  }
                >
                  <option value="weekly">Chaque semaine</option>
                  <option value="biweekly">Toutes les 2 semaines</option>
                  <option value="monthly">Chaque mois</option>
                </SelectField>
                <Field
                  label="Date de début"
                  type="date"
                  value={settings.start_date}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, start_date: event.target.value }))
                  }
                />
                <Field
                  label="Délai de paiement (jours)"
                  type="number"
                  min={0}
                  max={30}
                  value={settings.payment_deadline_days}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      payment_deadline_days: Number(event.target.value),
                    }))
                  }
                />
                <Field
                  label="Membres minimum"
                  type="number"
                  min={10}
                  max={100}
                  value={settings.min_members}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      min_members: Number(event.target.value),
                    }))
                  }
                />
                <Field
                  label="Membres maximum"
                  type="number"
                  min={10}
                  max={100}
                  value={settings.max_members}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      max_members: Number(event.target.value),
                    }))
                  }
                />
                <SelectField
                  label="Attribution des tours"
                  value={settings.payout_rule}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      payout_rule: event.target.value as 'strict' | 'flexible',
                    }))
                  }
                >
                  <option value="flexible">Flexible</option>
                  <option value="strict">Strict</option>
                </SelectField>
                <SelectField
                  label="Ordre initial"
                  value={settings.order_mode}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      order_mode: event.target.value as 'random' | 'manual',
                    }))
                  }
                >
                  <option value="random">Tirage au sort</option>
                  <option value="manual">Manuel</option>
                </SelectField>
              </div>

              <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={settings.beneficiary_pays}
                  disabled={locked}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      beneficiary_pays: event.target.checked,
                    }))
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
                />
                <span className="text-sm text-slate-600">
                  Le bénéficiaire cotise aussi son tour.
                </span>
              </label>

              {locked ? (
                <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
                  Les champs financiers sont désactivés car le groupe est lancé.
                </p>
              ) : null}

              <Button onClick={saveSettings} disabled={settingsLoading} className="w-full">
                {settingsLoading ? 'Enregistrement…' : 'Enregistrer les paramètres'}
              </Button>
            </Card>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
