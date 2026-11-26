'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError, type PayoutAccount } from '../../lib/api';
import { isAuthenticated } from '../../lib/session';
import { Alert, Field, PageShell, SubmitButton } from '../../components/ui';

const TYPE_LABELS: Record<PayoutAccount['type'], string> = {
  mtn_momo: 'MTN Mobile Money',
  orange_money: 'Orange Money',
  bank: 'Compte bancaire',
};

export default function ComptesReceptionPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<PayoutAccount[]>([]);
  const [form, setForm] = useState({
    type: 'mtn_momo' as PayoutAccount['type'],
    account_number: '',
    holder_name: '',
    otp_code: '',
  });
  const [otpRequested, setOtpRequested] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await apiFetch<PayoutAccount[]>('/me/payout-accounts');
    setAccounts(data);
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/connexion');
      return;
    }
    load().catch(() => router.replace('/connexion'));
  }, [load, router]);

  async function submit() {
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const result = await apiFetch<PayoutAccount & { otp_required?: boolean; message?: string }>(
        '/me/payout-accounts',
        {
          method: 'POST',
          body: JSON.stringify({
            type: form.type,
            account_number: form.account_number,
            holder_name: form.holder_name,
            ...(form.otp_code ? { otp_code: form.otp_code } : {}),
          }),
        },
      );

      if (result.otp_required) {
        setOtpRequested(true);
        setMessage(result.message ?? 'Un code vous a été envoyé par SMS.');
      } else {
        setOtpRequested(false);
        setForm({ type: 'mtn_momo', account_number: '', holder_name: '', otp_code: '' });
        setMessage('Compte ajouté. Il sera utilisable après 24 heures.');
        await load();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ajout impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Comptes de réception"
      subtitle="Le compte sur lequel vous recevrez votre tour. Activation différée de 24 h."
      backHref="/profil"
      backLabel="Profil"
    >
      <div className="space-y-6">
        <ul className="space-y-3">
          {accounts.length === 0 ? (
            <li>
              <Alert tone="info">Aucun compte enregistré pour le moment.</Alert>
            </li>
          ) : (
            accounts.map((account) => (
              <li
                key={account.id}
                className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
              >
                <p className="font-semibold">
                  {TYPE_LABELS[account.type]} · {account.account_number}
                </p>
                <p className="text-slate-600">{account.holder_name}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {account.active
                    ? 'Actif pour les décaissements'
                    : `Actif à partir du ${new Date(account.active_from).toLocaleDateString('fr-FR')}`}
                  {account.is_default ? ' · Par défaut' : ''}
                </p>
              </li>
            ))
          )}
        </ul>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error ? <Alert tone="error">{error}</Alert> : null}
          {message ? <Alert tone="success">{message}</Alert> : null}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Type de compte</span>
            <select
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  type: event.target.value as PayoutAccount['type'],
                }))
              }
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base"
            >
              <option value="mtn_momo">MTN Mobile Money</option>
              <option value="orange_money">Orange Money</option>
              <option value="bank">Compte bancaire</option>
            </select>
          </label>

          <Field
            label="Numéro de compte"
            value={form.account_number}
            onChange={(event) =>
              setForm((current) => ({ ...current, account_number: event.target.value }))
            }
            required
          />
          <Field
            label="Nom du titulaire"
            value={form.holder_name}
            onChange={(event) =>
              setForm((current) => ({ ...current, holder_name: event.target.value }))
            }
            required
          />

          {otpRequested ? (
            <Field
              label="Code reçu par SMS"
              value={form.otp_code}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  otp_code: event.target.value.replace(/\D/g, '').slice(0, 6),
                }))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              hint={
                process.env.NEXT_PUBLIC_DEV_OTP_CODE
                  ? `Mode développement : utilisez le code ${process.env.NEXT_PUBLIC_DEV_OTP_CODE}.`
                  : undefined
              }
              required
            />
          ) : null}

          <SubmitButton loading={loading}>
            {otpRequested ? 'Confirmer avec le code' : 'Ajouter ce compte'}
          </SubmitButton>
        </form>
      </div>
    </PageShell>
  );
}
