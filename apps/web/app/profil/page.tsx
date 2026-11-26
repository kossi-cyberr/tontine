'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError, type Profile } from '../../lib/api';
import { clearSession, getRefreshToken, isAuthenticated } from '../../lib/session';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Form,
  Spinner,
  SubmitButton,
} from '../../components/ui';
import { AppShell } from '../../components/app-shell';
import { ShieldIcon, WalletIcon } from '../../components/icons';

const KYC_LABELS: Record<Profile['kyc'], string> = {
  none: 'Non soumise',
  submitted: 'En vérification',
  verified: 'Vérifiée',
  rejected: 'Rejetée',
};

const KYC_TONE = {
  none: 'neutral',
  submitted: 'warning',
  verified: 'success',
  rejected: 'danger',
} as const;

export default function ProfilPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/connexion');
      return;
    }

    apiFetch<Profile>('/me')
      .then((data) => {
        setProfile(data);
        setFullName(data.full_name);
        setEmail(data.email ?? '');
      })
      .catch(() => {
        clearSession();
        router.replace('/connexion');
      });
  }, [router]);

  async function save() {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const updated = await apiFetch<Profile>('/me', {
        method: 'PATCH',
        body: JSON.stringify({ full_name: fullName, ...(email ? { email } : {}) }),
      });
      setProfile((current) => (current ? { ...current, ...updated } : updated));
      setMessage('Profil mis à jour.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      const refreshToken = getRefreshToken();
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      });
    } catch {
      // La session locale est effacée quoi qu'il arrive.
    }
    clearSession();
    router.replace('/connexion');
  }

  if (!profile) {
    return (
      <AppShell>
        <div className="mt-20 flex justify-center">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  const initials = profile.full_name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <AppShell
      title="Mon profil"
      subtitle="Vos informations personnelles et votre sécurité."
      hideCreate
    >
      <section className="relative overflow-hidden rounded-4xl bg-brand-gradient p-6 text-white shadow-float">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10 blur-2xl"
        />
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-white/15 text-xl font-black backdrop-blur">
            {initials || 'T'}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight">{profile.full_name}</h2>
            <p className="mt-0.5 text-sm text-emerald-50/90">{profile.phone}</p>
            <p className="truncate text-xs text-emerald-50/70">
              {profile.email ?? 'Email non renseigné'}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">
            KYC : {KYC_LABELS[profile.kyc]}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">
            2FA : {profile.two_fa_enabled ? 'activée' : 'désactivée'}
          </span>
          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">
            Compte {profile.status === 'active' ? 'actif' : profile.status}
          </span>
        </div>
      </section>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <a
          href="/kyc"
          className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <ShieldIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Identité (KYC)</p>
            <Badge tone={KYC_TONE[profile.kyc]}>{KYC_LABELS[profile.kyc]}</Badge>
          </div>
        </a>
        <a
          href="/comptes-reception"
          className="card flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
            <WalletIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Comptes de réception</p>
            <p className="text-xs text-slate-500">MTN MoMo · Orange Money</p>
          </div>
        </a>
      </div>

      <Card className="mt-4">
        <h2 className="text-sm font-bold text-ink">Informations personnelles</h2>
        <div className="mt-4">
          <Form onSubmit={save}>
            {error ? <Alert tone="error">{error}</Alert> : null}
            {message ? <Alert tone="success">{message}</Alert> : null}
            <Field
              label="Nom complet"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.cm"
            />
            <Field
              label="Téléphone"
              value={profile.phone}
              disabled
              hint="Le numéro identifie votre compte."
            />
            <SubmitButton loading={loading}>Enregistrer</SubmitButton>
          </Form>
        </div>
      </Card>

      <Button variant="secondary" onClick={logout} className="mt-4 w-full">
        Se déconnecter
      </Button>
    </AppShell>
  );
}
