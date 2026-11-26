'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { Alert, Field, Form, PageShell, SubmitButton } from '../../components/ui';

export default function MotDePasseOubliePage() {
  const [identifier, setIdentifier] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const result = await apiFetch<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      });
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Demande impossible pour le moment.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Mot de passe oublié"
      subtitle="Nous envoyons un code par SMS si un compte correspond à votre téléphone ou email."
      backHref="/connexion"
      backLabel="Connexion"
    >
      <Form onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? (
          <Alert tone="success">
            {message}{' '}
            <a
              href={`/reinitialisation?identifier=${encodeURIComponent(identifier)}`}
              className="font-semibold underline"
            >
              Saisir le code reçu
            </a>
          </Alert>
        ) : null}
        <Field
          label="Téléphone ou email"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          autoComplete="username"
          required
        />
        <SubmitButton loading={loading}>Recevoir un code</SubmitButton>
      </Form>
    </PageShell>
  );
}
