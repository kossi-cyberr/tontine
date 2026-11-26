'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from './ui';
import { ApiError } from '../lib/api';
import { adminApi, disputesApi, type Dispute } from '../lib/admin';

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

export function AdminDisputes() {
  const [items, setItems] = useState<Dispute[] | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('resolved');
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const result = await disputesApi.list({ status: filter || undefined, page_size: 50 });
      setItems(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Litiges indisponibles.');
    }
  }

  useEffect(() => {
    void load();
  }, [filter]);

  async function decide(dispute: Dispute) {
    setBusy(dispute.id);
    setError(null);
    setNotice(null);
    try {
      await disputesApi.update(dispute.id, {
        status,
        ...(status === 'in_review' ? {} : { resolution }),
      });
      setNotice('Décision enregistrée et plaignant notifié.');
      setSelected(null);
      setResolution('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Décision impossible.');
    } finally {
      setBusy(null);
    }
  }

  async function cancelRound(dispute: Dispute) {
    if (!dispute.round_id) return;
    const reason = window.prompt(
      'Motif de l’annulation du tour (10 caractères minimum) :',
      'Décision suite au litige',
    );
    if (!reason) return;
    setBusy(dispute.id);
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.cancelRound(dispute.round_id, reason);
      setNotice(
        `Tour annulé : ${result.refunded_contributions} cotisation(s), ${result.refunded_amount} XAF remboursés.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Annulation impossible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">Litiges</h2>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600"
        >
          <option value="">Tous les statuts</option>
          <option value="open">Ouverts</option>
          <option value="in_review">En examen</option>
          <option value="resolved">Résolus</option>
          <option value="rejected">Rejetés</option>
        </select>
      </div>

      {!items ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucun litige pour ce filtre.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((dispute) => (
            <li key={dispute.id} className="rounded-2xl border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{dispute.subject}</p>
                  <p className="text-[11px] text-slate-400">
                    {dispute.group_name ?? 'Groupe'} · ouvert par {dispute.opened_by_name ?? '—'} ·{' '}
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
                <p className="mt-1.5 rounded-xl bg-brand-50 px-3 py-2 text-[11px] text-brand-800">
                  Décision : {dispute.resolution}
                </p>
              ) : null}

              {['open', 'in_review'].includes(dispute.status) ? (
                selected === dispute.id ? (
                  <div className="mt-2 space-y-2">
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                    >
                      <option value="in_review">Mettre en examen</option>
                      <option value="resolved">Résoudre</option>
                      <option value="rejected">Rejeter</option>
                    </select>
                    {status !== 'in_review' ? (
                      <textarea
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        rows={3}
                        placeholder="Décision motivée (obligatoire)"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      />
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => void decide(dispute)}
                        disabled={
                          busy !== null || (status !== 'in_review' && resolution.trim().length < 10)
                        }
                        className="flex-1"
                      >
                        {busy === dispute.id ? 'Enregistrement…' : 'Enregistrer'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setSelected(dispute.id);
                        setStatus('resolved');
                        setResolution('');
                      }}
                    >
                      Traiter
                    </Button>
                    {dispute.round_id ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void cancelRound(dispute)}
                        disabled={busy !== null}
                      >
                        Annuler le tour
                      </Button>
                    ) : null}
                  </div>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

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
    </Card>
  );
}
