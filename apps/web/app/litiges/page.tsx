'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { AdminDisputes } from '../../components/admin-disputes';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';
import { apiFetch, ApiError, type Profile } from '../../lib/api';
import { disputesApi, type Dispute } from '../../lib/admin';
import { groupsApi, type Group } from '../../lib/groups';

const STATUS_LABELS: Record<Dispute['status'], string> = {
  open: 'Ouvert',
  in_review: 'En examen',
  resolved: 'Résolu',
  rejected: 'Rejeté',
};

const TONES: Record<Dispute['status'], 'warning' | 'brand' | 'success' | 'danger'> = {
  open: 'warning',
  in_review: 'brand',
  resolved: 'success',
  rejected: 'danger',
};

export default function DisputesPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const [list, myGroups] = await Promise.all([
        disputesApi.list({ page_size: 50 }),
        groupsApi.list(),
      ]);
      setDisputes(list.items);
      setGroups(myGroups);
      if (!groupId && myGroups[0]) setGroupId(myGroups[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Litiges indisponibles.');
    }
  }

  useEffect(() => {
    apiFetch<Profile>('/me')
      .then(setProfile)
      .catch(() => setProfile(null));
    void load();
  }, []);

  if (profile?.platform_role === 'super_admin') {
    return (
      <AppShell title="Litiges" subtitle="Traitement des litiges de la plateforme" hideCreate>
        <AdminDisputes />
      </AppShell>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const urls = attachments
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      await disputesApi.create({
        group_id: groupId,
        subject,
        description,
        attachments: urls,
      });
      setNotice('Litige ouvert. Les administrateurs vont l’examiner.');
      setSubject('');
      setDescription('');
      setAttachments('');
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ouverture impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Litiges"
      subtitle="Signalez un paiement ou un tour qui pose problème"
      hideCreate
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
          {open ? 'Fermer' : 'Ouvrir un litige'}
        </Button>
      }
    >
      {open ? (
        <Card>
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <label className="block text-xs font-semibold text-slate-500">
              Groupe
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Sujet
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
                minLength={5}
                maxLength={190}
                placeholder="Ex. Cotisation payée mais toujours en attente"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
                minLength={10}
                rows={4}
                placeholder="Décrivez les faits, dates, montants et références."
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-500">
              Pièces jointes (une URL par ligne, 5 maximum)
              <textarea
                value={attachments}
                onChange={(event) => setAttachments(event.target.value)}
                rows={2}
                placeholder="https://…"
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
            </label>
            <Button type="submit" disabled={busy || !groupId} className="w-full">
              {busy ? 'Envoi…' : 'Envoyer le litige'}
            </Button>
          </form>
        </Card>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      ) : null}

      {!disputes ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : disputes.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-slate-500">
            Aucun litige pour le moment. Un problème de paiement ou de tour peut être signalé ici.
          </p>
        </Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {disputes.map((dispute) => (
            <li key={dispute.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{dispute.subject}</p>
                    <p className="text-[11px] text-slate-400">
                      {dispute.group_name ?? 'Groupe'} ·{' '}
                      {new Date(dispute.created_at).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <Badge tone={TONES[dispute.status]}>{STATUS_LABELS[dispute.status]}</Badge>
                </div>
                <p className="mt-1.5 whitespace-pre-line text-xs text-slate-600">
                  {dispute.description}
                </p>
                {dispute.attachments.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {dispute.attachments.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-brand-700"
                      >
                        Pièce {index + 1}
                      </a>
                    ))}
                  </div>
                ) : null}
                {dispute.resolution ? (
                  <p className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-[11px] text-brand-800">
                    Décision : {dispute.resolution}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
