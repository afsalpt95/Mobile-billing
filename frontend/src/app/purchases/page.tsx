'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Select } from '@/components/ui/Field';
import { DataTable, ErrorState, Pagination, SearchInput, StatusBadge } from '@/components/ui/Misc';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatMoney, listRange } from '@/lib/utils';
import { purchaseService } from '@/services';
import type { Purchase } from '@/types';

export default function PurchasesPage() {
  return (
    <AppShell permission="purchases.read">
      <Purchases />
    </AppShell>
  );
}

function Purchases() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [range, setRange] = useState(initialRange('month'));
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounce(q, 300);
  const params = { q: search, ...listRange(range), status, paymentStatus, page, limit: 25 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.purchases, params], queryFn: () => purchaseService.list(params), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader
        title="Purchases"
        crumbs={[{ label: 'Purchases' }]}
        actions={
          can('purchases.write') && (
            <Link href="/purchases/new">
              <Button icon={<Plus className="h-4 w-4" />}>New purchase</Button>
            </Link>
          )
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Purchase no, vendor, vendor invoice, IMEI…" className="w-full sm:w-80" />
          <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
          <Select className="h-9 w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="RECEIVED">Received</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
          <Select className="h-9 w-auto py-1" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} aria-label="Payment">
            <option value="">Any payment</option>
            <option value="PAID">Paid</option>
            <option value="PARTIAL,UNPAID">Unpaid / partial</option>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <DataTable<Purchase>
            loading={isLoading}
            rows={data?.items}
            onRowClick={(p) => router.push(`/purchases/${p._id}`)}
            columns={[
              { key: 'no', header: 'Purchase', cell: (p) => <span className="font-medium text-brand-700">{p.purchaseNo}</span> },
              { key: 'date', header: 'Date', cell: (p) => formatDate(p.date) },
              { key: 'v', header: 'Vendor', cell: (p) => (<div><div>{p.vendorName}</div><div className="text-xs text-slate-500">{p.vendorInvoiceNo}</div></div>) },
              { key: 'items', header: 'Items', align: 'right', cell: (p) => p.items.length },
              { key: 'total', header: 'Total', align: 'right', cell: (p) => formatMoney(p.grandTotal) },
              { key: 'paid', header: 'Paid', align: 'right', cell: (p) => formatMoney(p.amountPaid) },
              { key: 'bal', header: 'Balance', align: 'right', cell: (p) => <span className={p.status === 'RECEIVED' && p.balanceDue > 0 ? 'font-medium text-amber-700' : ''}>{formatMoney(p.status === 'RECEIVED' ? p.balanceDue : 0)}</span> },
              { key: 'due', header: 'Due', cell: (p) => formatDate(p.dueDate) },
              { key: 'st', header: 'Status', cell: (p) => (<div className="flex gap-1"><StatusBadge status={p.status} />{p.status === 'RECEIVED' && <StatusBadge status={p.paymentStatus} />}{p.returnStatus !== 'NONE' && <StatusBadge status="FULL" label="Returned" />}</div>) },
            ]}
          />
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </div>
    </>
  );
}
