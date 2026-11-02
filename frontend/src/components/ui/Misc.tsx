'use client';

import { ChevronLeft, ChevronRight, Inbox, Loader2, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn, titleCase } from '@/lib/utils';

const tones = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  indigo: 'bg-brand-50 text-brand-700 ring-brand-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
};
export type Tone = keyof typeof tones;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>{children}</span>;
}

const statusTone: Record<string, Tone> = {
  PAID: 'green',
  PARTIAL: 'amber',
  UNPAID: 'red',
  COMPLETED: 'green',
  CANCELLED: 'gray',
  ACTIVE: 'green',
  DRAFT: 'amber',
  RECEIVED: 'blue',
  DIAGNOSIS_PENDING: 'amber',
  WAITING_APPROVAL: 'purple',
  WAITING_PARTS: 'amber',
  IN_PROGRESS: 'indigo',
  READY_FOR_DELIVERY: 'teal',
  DELIVERED: 'green',
  FULL: 'red',
  NONE: 'gray',
  RECEIPT: 'green',
  ADVANCE: 'teal',
  REFUND: 'red',
  PAYMENT: 'green',
  ADVANCE_APPLIED: 'teal',
  REFUND_RECEIVED: 'purple',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone[status] ?? 'gray'}>{label ?? titleCase(status)}</Badge>;
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'indigo',
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'indigo' | 'green' | 'amber' | 'red' | 'teal' | 'blue' | 'purple' | 'slate';
  loading?: boolean;
}) {
  const iconTone: Record<string, string> = {
    indigo: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    teal: 'bg-teal-50 text-teal-600',
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="card flex items-start gap-3 p-4">
      {icon && <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconTone[tone])}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        {loading ? <Skeleton className="mt-1.5 h-6 w-24" /> : <div className="mt-0.5 truncate text-lg font-semibold text-slate-900 tabular-nums">{value}</div>}
        {sub && !loading && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', message, action, icon }: { title?: string; message?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {message && <div className="max-w-sm text-sm text-slate-500">{message}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <div className="font-medium">Could not load data</div>
      <div className="mt-1">{error instanceof Error ? error.message : 'Unknown error'}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium text-red-800 underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ value: T; label: ReactNode }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
            t.value === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
      <span>
        {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <button type="button" className="rounded-md p-1.5 hover:bg-slate-100 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input type="search" className="input pl-9" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  sortKey?: string;
}

/** Table with loading skeleton, empty state, optional sorting and row click. */
export function DataTable<T extends { _id?: string }>({
  columns,
  rows,
  loading,
  empty,
  onRowClick,
  sort,
  onSort,
  rowClassName,
  footer,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  sort?: string;
  onSort?: (s: string) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
}) {
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn(align(c.align), c.className)}>
                {c.sortKey && onSort ? (
                  <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-slate-900" onClick={() => onSort(sort === c.sortKey ? `-${c.sortKey}` : c.sortKey!)}>
                    {c.header}
                    {sort === c.sortKey ? '▲' : sort === `-${c.sortKey}` ? '▼' : ''}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <Skeleton className="h-4 w-full max-w-[10rem]" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows?.map((r, i) => (
              <tr
                key={r._id ?? i}
                className={cn(onRowClick && 'cursor-pointer', rowClassName?.(r))}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn(align(c.align), c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
        {footer}
      </table>
      {!loading && rows && rows.length === 0 && (empty ?? <EmptyState />)}
    </div>
  );
}
