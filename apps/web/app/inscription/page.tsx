'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';
import { saveTokens, type TokenPair } from '../../lib/session';
import { Alert, Field, Form, PageShell, SubmitButton } from '../../components/ui';

export default function InscriptionPage() {
  const router = useRouter();
  const [form, setForm] = useState({ full_name: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const tokens = await apiFetch<TokenPair>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: form.full_name,
          phone: form.phone,
          password: form.password,
        }),
      });
      saveTokens(tokens);
      router.push('/profil');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Inscription impossible pour le moment.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Créer mon compte"
      subtitle="Avec votre nom, votre numéro et un mot de passe. Aucun code à attendre."
    >
      <Form onSubmit={submit}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Field
          label="Nom complet"
          value={form.full_name}
          onChange={update('full_name')}
          autoComplete="name"
          required
        />
        <Field
          label="Téléphone"
          value={form.phone}
          onChange={update('phone')}
          placeholder="+237650000000"
          autoComplete="tel"
          hint="Format international, ex. +237650000000"
          required
        />
        <Field
          label="Mot de passe"
          type="password"
          value={form.password}
          onChange={update('password')}
          autoComplete="new-password"
          hint="8 caractères minimum, avec majuscule, minuscule et chiffre."
          required
        />
        <SubmitButton loading={loading}>Créer mon compte</SubmitButton>
      </Form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Déjà inscrit ?{' '}
        <a href="/connexion" className="font-semibold text-brand-700">
          Se connecter
        </a>
      </p>
    </PageShell>
  );
}
