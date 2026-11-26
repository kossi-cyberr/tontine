'use client';

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { ArrowLeftIcon } from './icons';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <a href="/" className="inline-flex items-center gap-2.5">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-gradient text-lg font-black text-white shadow-float">
        T
      </span>
      {compact ? null : (
        <span className="leading-tight">
          <span className="block text-base font-bold tracking-tight text-ink">Tontine</span>
          <span className="block text-[11px] font-medium uppercase tracking-widest text-slate-500">
            Cameroun · XAF
          </span>
        </span>
      )}
    </a>
  );
}

export function PageShell({
  title,
  subtitle,
  children,
  backHref = '/',
  backLabel = 'Retour',
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  backHref?: string;
  backLabel?: string;
  eyebrow?: string;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-12 pt-6">
      <div className="flex items-center justify-between">
        <Logo />
        <a
          href={backHref}
          className="inline-flex items-center gap-1 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/70 transition hover:text-brand-700"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          {backLabel}
        </a>
      </div>

      <header className="mt-8 animate-fade-up">
        {eyebrow ? (
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{subtitle}</p>
        ) : null}
      </header>

      <div className="mt-6 animate-fade-up">{children}</div>
    </main>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`card ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input {...props} className="field-input" />
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextareaField({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <textarea {...props} className="field-input min-h-24 resize-y" />
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  children,
  ...props
}: {
  label: string;
  hint?: string;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <select {...props} className="field-input appearance-none">
        {children}
      </select>
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

const BUTTON_VARIANTS = {
  primary:
    'bg-brand-gradient text-white shadow-float hover:brightness-105 active:scale-[0.99] disabled:shadow-none',
  secondary:
    'bg-white text-ink ring-1 ring-slate-200 hover:ring-brand-300 hover:text-brand-700 active:scale-[0.99]',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-ink',
  danger: 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100',
} as const;

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: 'sm' | 'md';
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizes = {
    sm: 'px-3.5 py-2 text-xs',
    md: 'px-5 py-3 text-sm',
  }[size];

  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${sizes} ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function SubmitButton({
  children,
  loading,
  variant = 'primary',
}: {
  children: ReactNode;
  loading?: boolean;
  variant?: keyof typeof BUTTON_VARIANTS;
}) {
  return (
    <Button type="submit" disabled={loading} variant={variant} className="w-full">
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Veuillez patienter…
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand';
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-700 ring-amber-200',
    danger: 'bg-red-50 text-red-700 ring-red-200',
    brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ${tones}`}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50/90 text-red-700',
    success: 'border-brand-200 bg-brand-50/90 text-brand-800',
    info: 'border-slate-200 bg-white/80 text-slate-600',
  }[tone];

  return (
    <div role="status" className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

export function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
  );
}
