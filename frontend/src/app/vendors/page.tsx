'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { DataTable, ErrorState, Pagination, SearchInput, StatusBadge } from '@/components/ui/Misc';
import { VendorFormModal } from '@/features/masters/QuickCreate';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatMoney } from '@/lib/utils';
import { vendorService } from '@/services';
import type { Vendor } from '@/types';

export default function VendorsPage() {
  return (
    <AppShell permission="vendors.read">
      <Vendors />
    </AppShell>
  );
}

function Vendors() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [withBalance, setWithBalance] = useState(false);
  const [add, setAdd] = useState(false);
  const search = useDebounce(q, 300);
  const params = { q: search, page, limit: 25, withBalance: withBalance || undefined };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.vendors, 'list', params], queryFn: () => vendorService.list(params), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader
        title="Vendors"
        crumbs={[{ label: 'Vendors' }]}
        actions={
          can('vendors.write') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>
              Add vendor
            </Button>
          )
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Vendor name, contact, mobile…" className="w-full sm:w-80" autoFocus />
          <Checkbox label="With payable balance" checked={withBalance} onChange={(e) => setWithBalance(e.target.checked)} />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <DataTable<Vendor>
            loading={isLoading}
            rows={data?.items}
            onRowClick={(v) => router.push(`/vendors/${v._id}`)}
            columns={[
              { key: 'name', header: 'Vendor', cell: (v) => (<div><div className="font-medium">{v.name}</div><div className="text-xs text-slate-500">{v.vendorType?.name}</div></div>) },
              { key: 'contact', header: 'Contact', cell: (v) => [v.contactPerson, v.mobile].filter(Boolean).join(' · ') || '—' },
              { key: 'purchases', header: 'Total purchases', align: 'right', cell: (v) => formatMoney(v.totalPurchases) },
              { key: 'paid', header: 'Total paid', align: 'right', cell: (v) => formatMoney(v.totalPaid) },
              { key: 'bal', header: 'Payable', align: 'right', cell: (v) => <span className={v.balance > 0 ? 'font-semibold text-amber-700' : ''}>{formatMoney(v.balance)}</span> },
              { key: 'adv', header: 'Advance', align: 'right', cell: (v) => (v.advanceBalance ? <span className="text-teal-700">{formatMoney(v.advanceBalance)}</span> : '—') },
              { key: 'last', header: 'Last payment', cell: (v) => formatDate(v.lastPaymentAt) },
              { key: 'st', header: 'Status', cell: (v) => <StatusBadge status={v.isActive ? 'ACTIVE' : 'CANCELLED'} label={v.isActive ? 'Active' : 'Inactive'} /> },
            ]}
          />
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </div>
      <VendorFormModal open={add} onClose={() => setAdd(false)} onSaved={(v) => router.push(`/vendors/${v._id}`)} />
    </>
  );
}
