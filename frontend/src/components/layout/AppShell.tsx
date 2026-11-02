'use client';

import { ChevronRight, Home, LogOut, Menu, Smartphone, UserCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/Misc';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useCommon';
import { cn, titleCase } from '@/lib/utils';

const quickLinks = [
  { href: '/billing', label: 'New Sale', perm: 'sales.create' },
  { href: '/repairs', label: 'Repairs', perm: 'repairs.read' },
  { href: '/inventory', label: 'Stock', perm: 'inventory.read' },
  { href: '/customers', label: 'Customers', perm: 'customers.read' },
];

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return <span className="tabular-nums">{now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })} · {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>;
}

export function TopBar() {
  const { user, logout, can } = useAuth();
  const { data: settings } = useSettings();
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMenu(false), [pathname]);
  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Smartphone className="h-4 w-4" />
          </span>
          <span className="truncate">{settings?.shopName ?? 'Mobile Shop POS'}</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {quickLinks
            .filter((l) => can(l.perm))
            .map((l) => (
              <Link key={l.href} href={l.href} className={cn('rounded-md px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900', pathname.startsWith(l.href) && 'bg-slate-100 text-slate-900')}>
                {l.label}
              </Link>
            ))}
        </nav>
        <div className="ml-auto hidden text-sm text-slate-500 md:block">
          <Clock />
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100" aria-haspopup="menu" aria-expanded={menu}>
            <UserCircle2 className="h-6 w-6 text-slate-400" />
            <span className="hidden text-left leading-tight sm:block">
              <span className="block font-medium text-slate-800">{user?.name}</span>
              <span className="block text-xs text-slate-500">{titleCase(user?.role)}</span>
            </span>
            {menu ? <X className="h-4 w-4 text-slate-400 sm:hidden" /> : <Menu className="h-4 w-4 text-slate-400 sm:hidden" />}
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
              <Link role="menuitem" href="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                <Home className="h-4 w-4" /> Home
              </Link>
              {quickLinks
                .filter((l) => can(l.perm))
                .map((l) => (
                  <Link key={l.href} role="menuitem" href={l.href} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 lg:hidden">
                    <ChevronRight className="h-4 w-4" /> {l.label}
                  </Link>
                ))}
              <button role="menuitem" type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Authenticated page frame: top bar + permission gate. */
export function AppShell({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, can } = useAuth();
  useSettings();
  if (loading || !user) return <Spinner className="min-h-screen" />;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {permission && !can(permission) ? (
          <div className="card mx-auto mt-10 max-w-md p-6 text-center">
            <h1 className="text-lg font-semibold">Access restricted</h1>
            <p className="mt-2 text-sm text-slate-500">Your role ({titleCase(user.role)}) does not have access to this module. Ask an administrator if you need it.</p>
            <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700">
              Back to home
            </Link>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export function PageHeader({ title, crumbs = [], actions, subtitle }: { title: ReactNode; crumbs?: Array<{ label: string; href?: string }>; actions?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-800">
            Home
          </Link>
          {crumbs.map((c) => (
            <span key={c.label} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              {c.href ? (
                <Link href={c.href} className="hover:text-slate-800">
                  {c.label}
                </Link>
              ) : (
                <span className="text-slate-700">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        <h1 className="truncate text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
