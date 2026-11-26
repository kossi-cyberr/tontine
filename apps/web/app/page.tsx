import {
  ChartIcon,
  ShieldIcon,
  SparkIcon,
  UsersIcon,
  WalletIcon,
  CheckIcon,
} from '../components/icons';
import { Logo } from '../components/ui';

const features = [
  {
    icon: UsersIcon,
    title: 'Qui reçoit ce tour ?',
    description: 'Chaque membre voit immédiatement le bénéficiaire, le montant et la date.',
  },
  {
    icon: WalletIcon,
    title: 'Cotisation Mobile Money',
    description: 'Payez depuis MTN MoMo ou Orange Money, avec un reçu pour chaque versement.',
  },
  {
    icon: ShieldIcon,
    title: 'Séquestre transparent',
    description: 'Les fonds sont tracés dans un grand livre immuable, tour après tour.',
  },
];

const steps = [
  'Créez votre groupe et définissez les règles',
  'Invitez les membres avec un code unique',
  'Suivez les cotisations et les tours en direct',
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 pb-14 pt-6">
      <header className="flex items-center justify-between">
        <Logo />
        <a
          href="/connexion"
          className="rounded-full bg-white/80 px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200/80 transition hover:text-brand-700"
        >
          Se connecter
        </a>
      </header>

      <section className="relative mt-8 overflow-hidden rounded-4xl bg-brand-gradient p-7 text-white shadow-float animate-fade-up sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-10 h-52 w-52 rounded-full bg-emerald-300/20 blur-3xl"
        />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest backdrop-blur">
          <SparkIcon className="h-3.5 w-3.5" />
          Tontine digitale
        </span>
        <h1 className="mt-5 max-w-xl text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl">
          Cotisez ensemble, en toute confiance.
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-relaxed text-emerald-50/90 sm:text-base">
          Créez votre groupe, invitez vos membres et laissez la plateforme suivre les tours, les
          cotisations et les décaissements. Simple, traçable, pensé pour le Cameroun.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <a
            href="/inscription"
            className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-brand-800 shadow-lg transition hover:bg-emerald-50 active:scale-[0.99]"
          >
            Créer mon compte
          </a>
          <a
            href="/groupes/rejoindre"
            className="inline-flex items-center justify-center rounded-2xl bg-white/10 px-6 py-3.5 text-sm font-semibold text-white ring-1 ring-white/40 backdrop-blur transition hover:bg-white/20"
          >
            J&apos;ai un code d&apos;invitation
          </a>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-3 gap-3 animate-fade-up">
        {[
          ['100%', 'Mobile Money'],
          ['XAF', 'Montants locaux'],
          ['24/7', 'Suivi des tours'],
        ].map(([value, label]) => (
          <div
            key={label}
            className="rounded-3xl border border-white/70 bg-white/80 px-3 py-4 text-center shadow-card backdrop-blur"
          >
            <p className="text-lg font-black tracking-tight text-brand-700">{value}</p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold tracking-tight text-ink">
          Tout ce qu&apos;il faut pour votre tontine
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.title} className="card p-5">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-semibold text-ink">{feature.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                  {feature.description}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-10 overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-card backdrop-blur sm:p-8">
        <div className="flex items-center gap-2 text-brand-700">
          <ChartIcon className="h-5 w-5" />
          <h2 className="text-base font-bold tracking-tight">Comment ça marche</h2>
        </div>
        <ol className="mt-5 space-y-4">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {index + 1}
              </span>
              <p className="pt-1 text-sm text-slate-600">{step}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-xs font-medium text-brand-800">
          <CheckIcon className="h-4 w-4 shrink-0" />
          Vos fonds restent tracés de la cotisation au décaissement.
        </div>
      </section>

      <footer className="mt-auto pt-10 text-center text-xs text-slate-400">
        Montants en francs CFA (XAF) · Assistance en français
      </footer>
    </main>
  );
}
