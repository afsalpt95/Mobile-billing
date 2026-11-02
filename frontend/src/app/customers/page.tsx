'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { DataTable, ErrorState, Pagination, SearchInput, StatusBadge } from '@/components/ui/Misc';
import { CustomerFormModal } from '@/features/masters/QuickCreate';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatMoney } from '@/lib/utils';
import { customerService } from '@/services';
import type { Customer } from '@/types';

export default function CustomersPage() {
  return (
    <AppShell permission="customers.read">
      <Customers />
    </AppShell>
  );
}

function Customers() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('name');
  const [withBalance, setWithBalance] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [add, setAdd] = useState(false);
  const search = useDebounce(q, 300);
  const params = { q: search, page, limit: 25, sort, withBalance: withBalance || undefined, active: showInactive ? 'all' : undefined };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.customers, 'list', params], queryFn: () => customerService.list(params), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="Customers"
        crumbs={[{ label: 'Customers' }]}
        actions={
          can('customers.write') && (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdd(true)}>
              Add customer
            </Button>
          )
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, mobile or email…" className="w-full sm:w-80" autoFocus />
          <Checkbox label="With balance due" checked={withBalance} onChange={(e) => { setWithBalance(e.target.checked); setPage(1); }} />
          <Checkbox label="Include inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <DataTable<Customer>
            loading={isLoading}
            rows={data?.items}
            sort={sort}
            onSort={setSort}
            onRowClick={(c) => router.push(`/customers/${c._id}`)}
            columns={[
              { key: 'name', header: 'Customer', sortKey: 'name', cell: (c) => <span className="font-medium">{c.name}</span> },
              { key: 'mobile', header: 'Mobile', cell: (c) => c.mobile ?? '—' },
              { key: 'sales', header: 'Total purchases', align: 'right', sortKey: '-totalSales', cell: (c) => formatMoney(c.totalSales) },
              { key: 'paid', header: 'Total payments', align: 'right', cell: (c) => formatMoney(c.totalPaid) },
              { key: 'bal', header: 'Outstanding', align: 'right', sortKey: '-balance', cell: (c) => <span className={c.balance > 0 ? 'font-semibold text-amber-700' : c.balance < 0 ? 'text-teal-700' : ''}>{c.balance < 0 ? `Advance ${formatMoney(-c.balance)}` : formatMoney(c.balance)}</span> },
              { key: 'last', header: 'Last purchase', sortKey: '-lastPurchase', cell: (c) => formatDate(c.lastPurchaseAt) },
              { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.isActive ? 'ACTIVE' : 'CANCELLED'} label={c.isActive ? 'Active' : 'Inactive'} /> },
            ]}
          />
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </div>
      <CustomerFormModal open={add} onClose={() => setAdd(false)} onSaved={(c) => router.push(`/customers/${c._id}`)} />
    </>
  );
}
