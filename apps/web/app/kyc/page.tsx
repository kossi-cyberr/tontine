'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError, type Profile } from '../../lib/api';
import { isAuthenticated } from '../../lib/session';
import { Alert, PageShell, SubmitButton } from '../../components/ui';

const LABELS: Record<Profile['kyc'], string> = {
  none: 'Aucune pièce soumise',
  submitted: 'En cours de vérification',
  verified: 'Vérifiée',
  rejected: 'Rejetée',
};

export default function KycPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Profile['kyc'] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/connexion');
      return;
    }
    apiFetch<Profile>('/me')
      .then((profile) => setStatus(profile.kyc))
      .catch(() => router.replace('/connexion'));
  }, [router]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const input = event.currentTarget.elements.namedItem('document') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      setError('Sélectionnez un fichier.');
      return;
    }

    const body = new FormData();
    body.append('document', file);

    setLoading(true);
    try {
      const result = await apiFetch<{ message: string }>('/me/kyc', { method: 'POST', body });
      setStatus('submitted');
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="Vérification d’identité"
      subtitle="Votre pièce est chiffrée et visible uniquement par l’équipe de vérification."
      backHref="/profil"
      backLabel="Profil"
    >
      <div className="space-y-4">
        <Alert tone={status === 'verified' ? 'success' : 'info'}>
          Statut actuel : {status ? LABELS[status] : 'chargement…'}
        </Alert>

        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}

        <form className="space-y-4" onSubmit={submit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Photo de la CNI ou du passeport
            </span>
            <input
              name="document"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              required
            />
            <span className="mt-1 block text-xs text-slate-500">
              JPEG, PNG ou PDF — 5 Mo maximum.
            </span>
          </label>
          <SubmitButton loading={loading}>Envoyer ma pièce</SubmitButton>
        </form>
      </div>
    </PageShell>
  );
}
