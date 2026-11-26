'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, Field } from './ui';
import { ShieldIcon, WalletIcon } from './icons';
import { ApiError } from '../lib/api';
import { formatDate, formatXaf, type Round } from '../lib/groups';
import {
  PAYOUT_REASON_LABELS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_STATUS_TONE,
  payoutsApi,
  type RoundPayoutState,
} from '../lib/payments';

export function PayoutPanel({
  round,
  state,
  canManage,
  onChanged,
}: {
  round: Round;
  state: RoundPayoutState | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [receiptBusy, setReceiptBusy] = useState(false);

  const payout = state?.payout ?? null;
  const eligibility = state?.eligibility ?? null;
  const partial = eligibility ? eligibility.collected < eligibility.expected : false;

  async function prepare(allowPartial: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await payoutsApi.request(round.id, allowPartial);
      setNotice(
        created.reused
          ? 'Une demande de décaissement existe déjà pour ce tour.'
          : ((created as { message?: string }).message ?? 'Demande de décaissement enregistrée.'),
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Demande impossible pour le moment.');
    } finally {
      setBusy(false);
    }
  }

  async function startApproval() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await payoutsApi.approve(round.id);
      if (result.otp_required) {
        setOtpSent(true);
        setNotice('Un code OTP a été envoyé par SMS au gestionnaire approbateur.');
      } else {
        setNotice(result.message ?? 'Décaissement exécuté.');
        onChanged();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approbation impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmApproval() {
    setBusy(true);
    setError(null);
    try {
      const result = await payoutsApi.approve(round.id, otp.trim());
      setOtp('');
      setOtpSent(false);
      setNotice(
        result.message ??
          (result.requires_second_approval ? 'Validation enregistrée.' : 'Décaissement exécuté.'),
      );
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code incorrect ou approbation refusée.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadReceipt() {
    if (!payout) return;
    setReceiptBusy(true);
    setError(null);
    try {
      await payoutsApi.downloadReceipt(payout.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Justificatif indisponible.');
    } finally {
      setReceiptBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-brand-700">
          <ShieldIcon className="h-4 w-4" />
          <div>
            <h2 className="text-sm font-bold text-ink">
              Décaissement du tour {round.round_number}
            </h2>
            <p className="text-[11px] text-slate-500">
              {round.beneficiary.full_name} · {formatDate(round.payout_date)}
            </p>
          </div>
        </div>
        {payout ? (
          <Badge tone={PAYOUT_STATUS_TONE[payout.status]}>
            {PAYOUT_STATUS_LABELS[payout.status]}
          </Badge>
        ) : (
          <Badge tone={eligibility?.eligible ? 'success' : 'neutral'}>
            {eligibility?.eligible ? 'Éligible' : 'Non éligible'}
          </Badge>
        )}
      </div>

      {payout ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Brut</p>
            <p className="mt-0.5 font-bold text-slate-700">{formatXaf(payout.gross_amount)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Frais</p>
            <p className="mt-0.5 font-bold text-slate-700">
              {formatXaf(payout.platform_fee + payout.provider_fee)}
            </p>
          </div>
          <div className="rounded-2xl bg-emerald-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-emerald-600">Net versé</p>
            <p className="mt-0.5 font-bold text-emerald-800">{formatXaf(payout.net_amount)}</p>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Collecté</p>
            <p className="mt-0.5 font-bold text-slate-700">
              {formatXaf(eligibility?.collected ?? round.collected_amount)}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Attendu</p>
            <p className="mt-0.5 font-bold text-slate-700">
              {formatXaf(eligibility?.expected ?? round.expected_amount)}
            </p>
          </div>
        </div>
      )}

      {payout?.destination ? (
        <p className="mt-2 text-[11px] text-slate-500">
          Vers {payout.destination.holder_name} · {payout.destination.account_number}
        </p>
      ) : null}

      {payout?.status === 'failed' ? (
        <p className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {payout.failure_reason ?? 'Le virement a échoué.'}
          {payout.attempts >= 3
            ? ' Trois tentatives ont échoué : un administrateur doit intervenir.'
            : ` Tentative ${payout.attempts}/3 : une relance automatique est planifiée.`}
        </p>
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

      {!payout && eligibility && !eligibility.eligible ? (
        <ul className="mt-3 space-y-1 rounded-2xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-600">
          {eligibility.reasons.map((reason) => (
            <li key={reason}>• {PAYOUT_REASON_LABELS[reason] ?? reason}</li>
          ))}
        </ul>
      ) : null}

      {!payout && eligibility?.eligible && canManage ? (
        <div className="mt-4 space-y-2">
          <Button onClick={() => void prepare(partial)} disabled={busy} className="w-full">
            <WalletIcon className="h-4 w-4" />
            {busy
              ? 'Préparation…'
              : partial
                ? 'Demander un versement partiel'
                : 'Préparer le décaissement'}
          </Button>
          {partial ? (
            <p className="text-center text-[10px] leading-relaxed text-amber-700">
              La collecte est incomplète ({formatXaf(eligibility.collected)} sur{' '}
              {formatXaf(eligibility.expected)}). En tant que président, vous pouvez accepter un
              versement partiel.
            </p>
          ) : null}
        </div>
      ) : null}

      {payout && ['pending_approval', 'approved'].includes(payout.status) && canManage ? (
        <div className="mt-4 space-y-2">
          {otpSent ? (
            <>
              <Field
                label="Code OTP reçu par SMS"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                autoComplete="one-time-code"
              />
              <Button
                onClick={() => void confirmApproval()}
                disabled={busy || otp.length !== 6}
                className="w-full"
              >
                {busy ? 'Validation…' : 'Valider le décaissement'}
              </Button>
            </>
          ) : (
            <Button onClick={() => void startApproval()} disabled={busy} className="w-full">
              {busy ? 'Envoi du code…' : 'Approuver avec OTP'}
            </Button>
          )}
          <p className="text-center text-[10px] leading-relaxed text-slate-500">
            Le décaissement est versé au bénéficiaire après validation d’un gestionnaire. Le
            demandeur ne peut jamais approuver sa propre demande.
          </p>
        </div>
      ) : null}

      {payout && ['pending_approval', 'approved'].includes(payout.status) && !canManage ? (
        <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
          En attente de la validation du président ou du trésorier.
        </p>
      ) : null}

      {payout?.status === 'processing' ? (
        <p className="mt-3 rounded-2xl bg-brand-50 px-3 py-2.5 text-[11px] text-brand-800">
          Le virement est en cours chez l’opérateur. La confirmation arrivera automatiquement.
        </p>
      ) : null}

      {payout?.status === 'success' ? (
        <div className="mt-4 space-y-2">
          <p className="rounded-2xl bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-800">
            Versé le {formatDate(payout.executed_at)} · référence {payout.provider_reference ?? '—'}
          </p>
          <Button
            variant="secondary"
            onClick={() => void downloadReceipt()}
            disabled={receiptBusy}
            className="w-full"
          >
            {receiptBusy ? 'Préparation…' : 'Télécharger le justificatif PDF'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
