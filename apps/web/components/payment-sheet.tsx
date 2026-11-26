'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Field, Form, SelectField, Spinner } from './ui';
import { CheckIcon, WalletIcon } from './icons';
import { ApiError } from '../lib/api';
import { formatXaf } from '../lib/groups';
import {
  METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  newIdempotencyKey,
  paymentsApi,
  type Payment,
  type PaymentMethod,
} from '../lib/payments';

type Step = 'form' | 'waiting' | 'success' | 'failed';

export function PaymentSheet({
  contributionId,
  amount,
  penalty,
  defaultPhone = '',
  disabled = false,
  label = 'Payer ma cotisation',
  onPaid,
}: {
  contributionId: string;
  amount: number;
  penalty: number;
  defaultPhone?: string;
  disabled?: boolean;
  label?: string;
  onPaid?: () => void;
}) {
  const total = amount + penalty;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [method, setMethod] = useState<PaymentMethod>('mtn_momo');
  const [phone, setPhone] = useState(defaultPhone);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const keyRef = useRef<string | null>(null);

  const handleStatus = useCallback((latest: Payment) => {
    setPayment(latest);
    if (latest.status === 'confirmed') {
      setStep('success');
    } else if (latest.status === 'failed') {
      setStep('failed');
      setError(latest.failure_reason ?? 'Le paiement a été refusé. Vous pouvez réessayer.');
    }
  }, []);

  const paymentId = payment?.id ?? null;

  useEffect(() => {
    if (step !== 'waiting' || !paymentId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const latest = await paymentsApi.get(paymentId);
        if (!cancelled) handleStatus(latest);
      } catch {
        // Le paiement reste en attente : on réessaie au prochain tick.
      }
    };

    const timer = window.setInterval(() => void tick(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step, paymentId, handleStatus]);

  async function submit() {
    setLoading(true);
    setError(null);
    if (!keyRef.current) keyRef.current = newIdempotencyKey();

    try {
      const result = await paymentsApi.pay(
        contributionId,
        { method, payer_number: phone.trim() },
        keyRef.current,
      );
      setPayment(result);
      if (result.status === 'confirmed') {
        handleStatus(result);
      } else if (result.status === 'failed') {
        handleStatus(result);
      } else {
        setStep('waiting');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Paiement impossible pour le moment.');
    } finally {
      setLoading(false);
    }
  }

  async function checkNow() {
    if (!paymentId) return;
    try {
      handleStatus(await paymentsApi.get(paymentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification impossible.');
    }
  }

  function retry() {
    keyRef.current = null;
    setPayment(null);
    setError(null);
    setStep('form');
  }

  function close() {
    if (loading) return;
    if (step === 'success') onPaid?.();
    setOpen(false);
  }

  async function downloadReceipt() {
    if (!payment) return;
    setReceiptLoading(true);
    setError(null);
    try {
      await paymentsApi.downloadReceipt(payment.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reçu indisponible.');
    } finally {
      setReceiptLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled} className="w-full">
        <WalletIcon className="h-4 w-4" />
        {label}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Payer ma cotisation"
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-700">
                  Paiement sécurisé
                </p>
                <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
                  {step === 'success'
                    ? 'Paiement confirmé'
                    : step === 'waiting'
                      ? 'Confirmation en cours'
                      : 'Payer ma cotisation'}
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={loading}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 transition hover:text-ink disabled:opacity-50"
              >
                Fermer
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 ring-1 ring-brand-100">
              <div className="flex items-center justify-between text-xs text-brand-800">
                <span>Cotisation</span>
                <span className="font-semibold">{formatXaf(amount)}</span>
              </div>
              {penalty > 0 ? (
                <div className="mt-1 flex items-center justify-between text-xs text-amber-700">
                  <span>Pénalité de retard</span>
                  <span className="font-semibold">{formatXaf(penalty)}</span>
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between border-t border-brand-200/70 pt-2">
                <span className="text-sm font-semibold text-brand-900">Total à payer</span>
                <span className="text-xl font-black tracking-tight text-brand-900">
                  {formatXaf(total)}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-brand-700/80">
                Frais de paiement : 0 XAF · Fonds bloqués sur le séquestre du groupe.
              </p>
            </div>

            {error ? (
              <div className="mt-3">
                <Alert tone="error">{error}</Alert>
              </div>
            ) : null}

            {step === 'form' ? (
              <Form onSubmit={submit}>
                <SelectField
                  label="Moyen de paiement"
                  value={method}
                  onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                >
                  <option value="mtn_momo">{METHOD_LABELS.mtn_momo}</option>
                  <option value="orange_money">{METHOD_LABELS.orange_money}</option>
                  <option value="bank">{METHOD_LABELS.bank}</option>
                </SelectField>
                <Field
                  label="Numéro à débiter"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+237 6XX XXX XXX"
                  inputMode="tel"
                  autoComplete="tel"
                  hint="Une demande de confirmation sera envoyée sur ce numéro."
                  required
                />
                <Button
                  type="submit"
                  disabled={loading || phone.trim().length < 6}
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Envoi de la demande…
                    </>
                  ) : (
                    <>Payer {formatXaf(total)}</>
                  )}
                </Button>
                <p className="text-center text-[10px] leading-relaxed text-slate-500">
                  Le paiement n’est validé qu’après confirmation de l’opérateur. Vous pouvez
                  réessayer sans risque de double débit.
                </p>
              </Form>
            ) : null}

            {step === 'waiting' ? (
              <div className="mt-5 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-amber-50">
                  <Spinner />
                </div>
                <p className="mt-3 text-sm font-semibold text-ink">
                  Confirmez la demande sur votre téléphone
                </p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                  Saisissez votre code PIN Mobile Money. Cette page se met à jour automatiquement
                  dès réception de la confirmation.
                </p>
                {payment?.provider_reference ? (
                  <p className="mt-3 break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-[10px] text-slate-500">
                    {payment.provider_reference}
                  </p>
                ) : null}
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Badge tone="warning">
                    {PAYMENT_STATUS_LABELS[payment?.status ?? 'pending']}
                  </Badge>
                </div>
                <Button variant="secondary" onClick={() => void checkNow()} className="mt-4 w-full">
                  J’ai confirmé, vérifier maintenant
                </Button>
                <button
                  type="button"
                  onClick={close}
                  className="mt-3 text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
                >
                  Fermer et vérifier plus tard
                </button>
              </div>
            ) : null}

            {step === 'success' && payment ? (
              <div className="mt-5 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
                  <CheckIcon className="h-7 w-7" />
                </div>
                <p className="mt-3 text-xl font-black tracking-tight text-ink">
                  {formatXaf(total)}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Votre cotisation est enregistrée sur le séquestre du groupe.
                </p>
                <div className="mt-3 flex justify-center">
                  <Badge tone="success">{PAYMENT_STATUS_LABELS.confirmed}</Badge>
                </div>
                {payment.receipt_number ? (
                  <p className="mt-3 text-[11px] text-slate-500">
                    Reçu N°{' '}
                    <span className="font-mono font-semibold">{payment.receipt_number}</span>
                  </p>
                ) : null}
                <div className="mt-5 space-y-2">
                  <Button
                    onClick={() => void downloadReceipt()}
                    disabled={receiptLoading}
                    className="w-full"
                  >
                    {receiptLoading ? 'Préparation du reçu…' : 'Télécharger mon reçu PDF'}
                  </Button>
                  <Button variant="secondary" onClick={close} className="w-full">
                    Fermer
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 'failed' ? (
              <div className="mt-5 space-y-3">
                <Alert tone="error">
                  {error ?? 'Le paiement a échoué. Aucun montant n’a été débité.'}
                </Alert>
                <Button onClick={retry} className="w-full">
                  Réessayer avec un nouveau paiement
                </Button>
                <Button variant="secondary" onClick={close} className="w-full">
                  Annuler
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
