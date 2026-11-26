'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { Alert, Field, Form, PageShell, SubmitButton } from '../../components/ui';

export default function ReinitialisationPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('identifier');
    if (value) setIdentifier(value);
  }, []);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ identifier, code, new_password: password }),
      });
      router.push('/connexion?reset=1');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Réinitialisation impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="Nouveau mot de passe" subtitle="Saisissez le code reçu par SMS.">
      <Form onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Téléphone ou email"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />
        <Field
          label="Code reçu"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        <Field
          label="Nouveau mot de passe"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          hint="8 caractères minimum, avec majuscule, minuscule et chiffre."
          required
        />
        <SubmitButton loading={loading}>Changer mon mot de passe</SubmitButton>
      </Form>
    </PageShell>
  );
}
