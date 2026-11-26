'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { Alert, Field, Form, PageShell, SubmitButton } from '../../components/ui';

export default function ActivationPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    if (value) setToken(value);
  }, []);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/auth/activate', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      router.push('/connexion?activated=1');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Activation impossible. Demandez un nouveau lien à votre président.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Activer mon compte"
      subtitle="Votre président vous a invité : choisissez votre mot de passe pour activer le compte."
    >
      <Form onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Lien d’activation"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          hint="Renseigné automatiquement si vous suivez le lien reçu."
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
        <SubmitButton loading={loading}>Activer mon compte</SubmitButton>
      </Form>
    </PageShell>
  );
}
