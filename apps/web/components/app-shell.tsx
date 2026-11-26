'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BellIcon, HomeIcon, PlusIcon, ShieldIcon, UserIcon, UsersIcon } from './icons';
import { Logo } from './ui';
import { notificationsApi } from '../lib/notifications';
import { isAuthenticated } from '../lib/session';
import { apiFetch, type Profile } from '../lib/api';

const NAV = [
  { href: '/', label: 'Accueil', icon: HomeIcon },
  { href: '/groupes', label: 'Groupes', icon: UsersIcon },
  { href: '/profil', label: 'Profil', icon: UserIcon },
];

export function AppShell({
  children,
  title,
  subtitle,
  action,
  hideCreate = false,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  hideCreate?: boolean;
}) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) return;
    notificationsApi
      .count()
      .then((result) => setUnread(result.unread))
      .catch(() => setUnread(0));
    apiFetch<Profile>('/me')
      .then((profile) => setIsAdmin(profile.platform_role === 'super_admin'))
      .catch(() => setIsAdmin(false));
  }, [pathname]);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-32 pt-5 sm:px-6">
      <header className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          {action}
          {isAdmin ? (
            <a
              href="/admin"
              aria-label="Administration"
              className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-brand-700 shadow-sm ring-1 ring-brand-200 transition hover:bg-brand-50"
            >
              <ShieldIcon className="h-5 w-5" />
            </a>
          ) : null}
          <a
            href="/litiges"
            aria-label="Litiges"
            className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 transition hover:text-brand-700"
          >
            <span className="text-sm font-black">!</span>
          </a>
          <a
            href="/notifications"
            aria-label="Notifications"
            className="relative grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 transition hover:text-brand-700"
          >
            <BellIcon className="h-5 w-5" />
            {unread > 0 ? (
              <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold leading-[18px] text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            ) : null}
          </a>
          <a
            href="/profil"
            aria-label="Mon profil"
            className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/80 transition hover:text-brand-700"
          >
            <UserIcon className="h-5 w-5" />
          </a>
        </div>
      </header>

      {title ? (
        <div className="mt-7 flex items-end justify-between gap-3 animate-fade-up">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          {hideCreate ? null : (
            <a
              href="/groupes/nouveau"
              className="hidden shrink-0 items-center gap-1.5 rounded-2xl bg-brand-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-float sm:inline-flex"
            >
              <PlusIcon className="h-4 w-4" />
              Nouveau groupe
            </a>
          )}
        </div>
      ) : null}

      <div className="mt-6">{children}</div>

      <nav
        aria-label="Navigation principale"
        className="fixed bottom-3 left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 rounded-full border border-white/80 bg-white/95 p-1.5 shadow-nav backdrop-blur"
      >
        <div className="grid grid-cols-3 gap-1">
          {NAV.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 rounded-full px-3 py-2 text-[11px] font-semibold transition ${
                  active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-ink'
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </a>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function FloatingCreate() {
  return (
    <a
      href="/groupes/nouveau"
      aria-label="Créer un groupe"
      className="fixed bottom-24 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-brand-gradient text-white shadow-float transition active:scale-95 sm:hidden"
    >
      <PlusIcon className="h-6 w-6" />
    </a>
  );
}
