'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import {
  Alert,
  Field,
  Form,
  SelectField,
  SubmitButton,
  TextareaField,
} from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { isAuthenticated } from '../../../lib/session';
import { groupsApi, type Frequency, type CreateGroupPayload } from '../../../lib/groups';

function defaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

const INITIAL: CreateGroupPayload = {
  name: '',
  description: '',
  rules_text: '',
  contribution_amount: 5000,
  frequency: 'monthly',
  start_date: defaultStartDate(),
  min_members: 10,
  max_members: 20,
  payout_rule: 'flexible',
  beneficiary_pays: true,
  payment_deadline_days: 2,
  late_fee_type: 'fixed',
  late_fee_value: 0,
  platform_fee_type: 'percent',
  platform_fee_value: 0,
  order_mode: 'random',
  dual_approval_threshold: null,
};

export default function NouveauGroupePage() {
  const router = useRouter();
  const [form, setForm] = useState<CreateGroupPayload>(INITIAL);
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/connexion');
  }, [router]);

  function patch<K extends keyof CreateGroupPayload>(key: K, value: CreateGroupPayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const created = await groupsApi.create({
        ...form,
        description: form.description?.trim() || undefined,
        rules_text: form.rules_text?.trim() || undefined,
      });
      router.push(`/groupes/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl pt-2">
        <div className="mb-6 animate-fade-up">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700">
            Nouvelle tontine
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Créer un groupe</h1>
          <p className="mt-2 text-sm text-slate-500">
            Vous serez président et pourrez inviter les membres dès la création.
          </p>
        </div>

        <Form onSubmit={submit}>
          {error ? <Alert tone="error">{error}</Alert> : null}

          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-ink">Informations générales</h2>
            <Field
              label="Nom du groupe"
              value={form.name}
              onChange={(event) => patch('name', event.target.value)}
              placeholder="Ex. Tontine des amis de Douala"
              minLength={3}
              maxLength={150}
              required
            />
            <TextareaField
              label="Description (facultatif)"
              value={form.description ?? ''}
              onChange={(event) => patch('description', event.target.value)}
              placeholder="Objectif du groupe, lieu de réunion…"
              maxLength={2000}
            />
            <TextareaField
              label="Règlement intérieur (facultatif)"
              value={form.rules_text ?? ''}
              onChange={(event) => patch('rules_text', event.target.value)}
              placeholder="Règles de fonctionnement, sanctions, ordre de passage…"
              maxLength={10000}
            />
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-ink">Cotisation et calendrier</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Cotisation par tour (XAF)"
                type="number"
                min={1000}
                max={5000000}
                step={500}
                value={form.contribution_amount}
                onChange={(event) => patch('contribution_amount', Number(event.target.value))}
                required
              />
              <SelectField
                label="Fréquence"
                value={form.frequency}
                onChange={(event) => patch('frequency', event.target.value as Frequency)}
              >
                <option value="weekly">Chaque semaine</option>
                <option value="biweekly">Toutes les 2 semaines</option>
                <option value="monthly">Chaque mois</option>
              </SelectField>
              <Field
                label="Date de début"
                type="date"
                value={form.start_date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => patch('start_date', event.target.value)}
                required
              />
              <Field
                label="Délai de paiement (jours)"
                type="number"
                min={0}
                max={30}
                value={form.payment_deadline_days}
                onChange={(event) => patch('payment_deadline_days', Number(event.target.value))}
              />
              <Field
                label="Membres minimum"
                type="number"
                min={10}
                max={100}
                value={form.min_members}
                onChange={(event) => patch('min_members', Number(event.target.value))}
                hint="La plateforme exige au moins 10 membres."
                required
              />
              <Field
                label="Membres maximum"
                type="number"
                min={10}
                max={100}
                value={form.max_members}
                onChange={(event) => patch('max_members', Number(event.target.value))}
                required
              />
            </div>
          </section>

          <section className="card space-y-4 p-5">
            <h2 className="text-sm font-bold text-ink">Règles de passage</h2>
            <SelectField
              label="Attribution des tours"
              value={form.payout_rule}
              onChange={(event) =>
                patch('payout_rule', event.target.value as 'strict' | 'flexible')
              }
              hint="Strict : l’ordre est verrouillé. Flexible : ajustements possibles."
            >
              <option value="flexible">Flexible</option>
              <option value="strict">Strict</option>
            </SelectField>
            <SelectField
              label="Ordre initial"
              value={form.order_mode}
              onChange={(event) => patch('order_mode', event.target.value as 'random' | 'manual')}
            >
              <option value="random">Tirage au sort</option>
              <option value="manual">Défini manuellement</option>
            </SelectField>
            <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <input
                type="checkbox"
                checked={form.beneficiary_pays}
                onChange={(event) => patch('beneficiary_pays', event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-slate-600">
                Le bénéficiaire cotise aussi le mois où il reçoit.
              </span>
            </label>
          </section>

          <section className="card p-5">
            <button
              type="button"
              onClick={() => setAdvanced((value) => !value)}
              className="flex w-full items-center justify-between text-sm font-bold text-ink"
            >
              Options avancées
              <span className="text-xs font-semibold text-brand-700">
                {advanced ? 'Masquer' : 'Afficher'}
              </span>
            </button>

            {advanced ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Type de pénalité de retard"
                  value={form.late_fee_type}
                  onChange={(event) =>
                    patch('late_fee_type', event.target.value as 'fixed' | 'percent')
                  }
                >
                  <option value="fixed">Montant fixe</option>
                  <option value="percent">Pourcentage</option>
                </SelectField>
                <Field
                  label="Valeur de la pénalité"
                  type="number"
                  min={0}
                  value={form.late_fee_value}
                  onChange={(event) => patch('late_fee_value', Number(event.target.value))}
                />
                <SelectField
                  label="Frais plateforme"
                  value={form.platform_fee_type}
                  onChange={(event) =>
                    patch('platform_fee_type', event.target.value as 'fixed' | 'percent')
                  }
                >
                  <option value="percent">Pourcentage</option>
                  <option value="fixed">Montant fixe</option>
                </SelectField>
                <Field
                  label="Valeur des frais plateforme"
                  type="number"
                  min={0}
                  value={form.platform_fee_value}
                  onChange={(event) => patch('platform_fee_value', Number(event.target.value))}
                />
                <Field
                  label="Double validation au-delà de (XAF)"
                  type="number"
                  min={0}
                  value={form.dual_approval_threshold ?? ''}
                  onChange={(event) =>
                    patch(
                      'dual_approval_threshold',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                  hint="Laisser vide pour désactiver."
                />
              </div>
            ) : null}
          </section>

          <SubmitButton loading={loading}>Créer le groupe</SubmitButton>
          <p className="pb-2 text-center text-xs text-slate-400">
            Les règles financières seront figées au lancement du groupe.
          </p>
        </Form>
      </div>
    </AppShell>
  );
}
