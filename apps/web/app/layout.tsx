import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Tontine — cotisez ensemble, en toute confiance',
    template: '%s · Tontine',
  },
  description:
    'Plateforme de tontine en ligne au Cameroun : cotisations Mobile Money, séquestre sécurisé et décaissements vérifiés.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Tontine',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f9d58',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-surface font-sans text-slate-900">{children}</body>
    </html>
  );
}
