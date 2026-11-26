'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { Alert, Badge, Button, EmptyState, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { clearSession, isAuthenticated } from '../../lib/session';
import { notificationsApi, type AppNotification } from '../../lib/notifications';
import { formatDate } from '../../lib/groups';

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await notificationsApi.list());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearSession();
        router.replace('/connexion');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les notifications.');
      setItems([]);
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/connexion');
      return;
    }
    void load();
  }, [load, router]);

  async function markRead(notification: AppNotification) {
    if (notification.read) return;
    setItems(
      (current) =>
        current?.map((item) => (item.id === notification.id ? { ...item, read: true } : item)) ??
        null,
    );
    try {
      await notificationsApi.read(notification.id);
    } catch {
      // L'état local reste optimiste ; un rechargement corrigera si besoin.
    }
  }

  async function markAll() {
    setBusy(true);
    setError(null);
    try {
      await notificationsApi.readAll();
      setItems((current) => current?.map((item) => ({ ...item, read: true })) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  const unread = items?.filter((item) => !item.read).length ?? 0;

  return (
    <AppShell
      title="Notifications"
      subtitle="Paiements, rappels et décaissements de vos tontines."
      hideCreate
      action={
        unread > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => void markAll()} disabled={busy}>
            Tout lire
          </Button>
        ) : undefined
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      {items === null ? (
        <div className="mt-16 flex justify-center">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Aucune notification"
            description="Vous recevrez ici les confirmations de paiement, les rappels de cotisation et les décaissements."
          />
        </div>
      ) : (
        <ul className="mt-5 space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void markRead(item)}
                className={`w-full rounded-3xl border px-4 py-3.5 text-left transition ${
                  item.read
                    ? 'border-white/70 bg-white/70'
                    : 'border-brand-200 bg-white shadow-card'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-ink">{item.title}</p>
                      {item.read ? null : <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.message}</p>
                  </div>
                  <Badge tone={item.read ? 'neutral' : 'brand'}>
                    {item.read ? 'Lue' : 'Nouvelle'}
                  </Badge>
                </div>
                <p className="mt-2 text-[10px] text-slate-400">{formatDate(item.created_at)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
