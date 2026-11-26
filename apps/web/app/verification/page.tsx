'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { Alert, Field, Form, PageShell, SubmitButton } from '../../components/ui';

export default function VerificationPage() {
  const router = useRouter();
  const [target, setTarget] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('target');
    if (value) setTarget(value);
  }, []);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ target, purpose: 'register', code }),
      });
      router.push('/connexion?activated=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Vérifier mon numéro"
      subtitle="Saisissez le code à 6 chiffres reçu par SMS. Il expire au bout de 10 minutes."
      backHref="/inscription"
      backLabel="Modifier mes informations"
    >
      <Form onSubmit={submit}>
        {process.env.NEXT_PUBLIC_DEV_OTP_CODE ? (
          <Alert tone="info">
            Mode développement : aucun SMS réel n’est envoyé. Utilisez le code{' '}
            <strong>{process.env.NEXT_PUBLIC_DEV_OTP_CODE}</strong>.
          </Alert>
        ) : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Téléphone"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="+237650000000"
          autoComplete="tel"
        />
        <Field
          label="Code de vérification"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          required
        />
        <SubmitButton loading={loading}>Valider mon compte</SubmitButton>
      </Form>
    </PageShell>
  );
}
