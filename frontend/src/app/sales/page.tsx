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
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, formatMoney, listRange } from '@/lib/utils';
import { saleService } from '@/services';
import type { Sale } from '@/types';

export default function SalesListPage() {
  return (
    <AppShell permission="sales.read">
      <SalesList />
    </AppShell>
  );
}

function SalesList() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [range, setRange] = useState(initialRange('month'));
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [page, setPage] = useState(1);
  const search = useDebounce(q, 300);
  const params = { q: search, ...listRange(range), status, paymentStatus, page, limit: 25 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.sales, params], queryFn: () => saleService.list(params), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="Invoices"
        crumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Invoices' }]}
        actions={
          <Link href="/billing">
            <Button icon={<Plus className="h-4 w-4" />}>New sale</Button>
          </Link>
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Invoice no, customer, mobile, IMEI…" className="w-full sm:w-72" />
          <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
          <Select className="h-9 w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
          <Select className="h-9 w-auto py-1" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} aria-label="Payment status">
            <option value="">Any payment</option>
            <option value="PAID">Paid</option>
            <option value="PARTIAL,UNPAID">With balance due</option>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <DataTable<Sale>
            loading={isLoading}
            rows={data?.items}
            onRowClick={(s) => router.push(`/sales/${s._id}`)}
            columns={[
              { key: 'no', header: 'Invoice', cell: (s) => <span className="font-medium text-brand-700">{s.invoiceNo}</span> },
              { key: 'date', header: 'Date', cell: (s) => formatDateTime(s.date) },
              { key: 'cust', header: 'Customer', cell: (s) => (<div><div>{s.customerName}</div><div className="text-xs text-slate-500">{s.customerMobile}</div></div>) },
              { key: 'total', header: 'Total', align: 'right', cell: (s) => formatMoney(s.grandTotal) },
              { key: 'paid', header: 'Paid', align: 'right', cell: (s) => formatMoney(s.amountPaid) },
              { key: 'due', header: 'Balance', align: 'right', cell: (s) => <span className={s.balanceDue > 0 ? 'font-medium text-amber-700' : ''}>{formatMoney(s.balanceDue)}</span> },
              { key: 'ps', header: 'Payment', cell: (s) => <StatusBadge status={s.paymentStatus} /> },
              { key: 'st', header: 'Status', cell: (s) => (<div className="flex gap-1"><StatusBadge status={s.status} />{s.returnStatus !== 'NONE' && <StatusBadge status={s.returnStatus} label={`${s.returnStatus === 'FULL' ? 'Fully' : 'Partly'} returned`} />}{s.repairJob && <StatusBadge status="IN_PROGRESS" label="Repair" />}</div>) },
            ]}
          />
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </div>
    </>
  );
}
