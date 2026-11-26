'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { saveTokens, type TokenPair } from '../../lib/session';
import { Alert, Field, Form, PageShell, SubmitButton } from '../../components/ui';

export default function ConnexionPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const tokens = await apiFetch<TokenPair>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          identifier,
          password,
          ...(totp ? { totp_code: totp } : {}),
        }),
      });
      saveTokens(tokens);
      router.push('/profil');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setNeedsTotp(true);
        setError('Saisissez le code de votre application d’authentification.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Connexion impossible.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell title="Se connecter" subtitle="Avec votre téléphone ou votre email.">
      <Form onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Téléphone ou email"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          autoComplete="username"
          required
        />
        <Field
          label="Mot de passe"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        {needsTotp ? (
          <Field
            label="Code de double authentification"
            value={totp}
            onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
        ) : null}
        <SubmitButton loading={loading}>Se connecter</SubmitButton>
      </Form>
      <div className="mt-6 flex justify-between text-sm">
        <a href="/mot-de-passe-oublie" className="font-medium text-slate-600">
          Mot de passe oublié ?
        </a>
        <a href="/inscription" className="font-semibold text-brand-700">
          Créer un compte
        </a>
      </div>
    </PageShell>
  );
}
