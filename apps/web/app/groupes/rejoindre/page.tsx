'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { Alert, Field, Form, SubmitButton } from '../../../components/ui';
import { UsersIcon } from '../../../components/icons';
import { ApiError } from '../../../lib/api';
import { isAuthenticated } from '../../../lib/session';
import { groupsApi } from '../../../lib/groups';

export default function RejoindreGroupePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/connexion');
  }, [router]);

  async function submit() {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await groupsApi.join(code.trim().toUpperCase());
      setSuccess(result.message);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Demande impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-lg pt-4">
        <div className="card overflow-hidden p-0">
          <div className="bg-brand-gradient px-6 py-8 text-white">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 backdrop-blur">
              <UsersIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight">Rejoindre une tontine</h1>
            <p className="mt-1.5 text-sm text-emerald-50/90">
              Saisissez le code d’invitation partagé par le président du groupe. Votre demande devra
              être validée.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {error ? <Alert tone="error">{error}</Alert> : null}
            {success ? (
              <Alert tone="success">
                {success}{' '}
                <a href="/groupes" className="font-semibold underline">
                  Voir mes groupes
                </a>
              </Alert>
            ) : null}

            <Form onSubmit={submit}>
              <Field
                label="Code d’invitation"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="EX. DEMO2026"
                autoComplete="off"
                inputMode="text"
                maxLength={12}
                required
              />
              <SubmitButton loading={loading}>Envoyer ma demande</SubmitButton>
            </Form>

            <p className="text-center text-xs text-slate-500">
              Le code comporte 8 caractères, sans les lettres I, O, 0 et 1.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
