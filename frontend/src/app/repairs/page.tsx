'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DataTable, ErrorState, Pagination, SearchInput, StatusBadge, Tabs } from '@/components/ui/Misc';
import { WarrantyLookupModal } from '@/features/repairs/WarrantyLookup';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatMoney } from '@/lib/utils';
import { repairService } from '@/services';
import type { RepairJob } from '@/types';

const FILTERS = {
  open: 'RECEIVED,DIAGNOSIS_PENDING,WAITING_APPROVAL,WAITING_PARTS,IN_PROGRESS',
  ready: 'READY_FOR_DELIVERY',
  delivered: 'DELIVERED',
  cancelled: 'CANCELLED',
  all: '',
} as const;
type Filter = keyof typeof FILTERS;

export default function RepairsPage() {
  return (
    <AppShell permission="repairs.read">
      <Repairs />
    </AppShell>
  );
}

function Repairs() {
  const router = useRouter();
  const { can } = useAuth();
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [warranty, setWarranty] = useState(false);
  const search = useDebounce(q, 300);
  const params = { q: search, status: FILTERS[filter] || undefined, page, limit: 25 };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.repairs, params], queryFn: () => repairService.list(params), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader
        title="Repair Service"
        crumbs={[{ label: 'Repairs' }]}
        actions={
          <>
            <Button variant="outline" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setWarranty(true)}>
              Warranty lookup
            </Button>
            {can('repairs.write') && (
              <Link href="/repairs/new">
                <Button icon={<Plus className="h-4 w-4" />}>New repair job</Button>
              </Link>
            )}
          </>
        }
      />
      <div className="card">
        <Tabs<Filter>
          className="px-3"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(1);
          }}
          tabs={[
            { value: 'open', label: 'In workshop' },
            { value: 'ready', label: 'Ready for delivery' },
            { value: 'delivered', label: 'Delivered' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'all', label: 'All' },
          ]}
        />
        <div className="border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Job no, customer, mobile, IMEI, model…" className="w-full sm:w-80" autoFocus />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <DataTable<RepairJob>
            loading={isLoading}
            rows={data?.items}
            onRowClick={(r) => router.push(`/repairs/${r._id}`)}
            rowClassName={(r) => (r.expectedDeliveryAt && new Date(r.expectedDeliveryAt) < new Date() && !['DELIVERED', 'CANCELLED', 'READY_FOR_DELIVERY'].includes(r.status) ? 'bg-amber-50/50' : undefined)}
            columns={[
              { key: 'no', header: 'Job', cell: (r) => <span className="font-medium text-brand-700">{r.jobNo}</span> },
              { key: 'rec', header: 'Received', cell: (r) => formatDate(r.receivedAt) },
              { key: 'cust', header: 'Customer', cell: (r) => (<div><div>{r.customerName}</div><div className="text-xs text-slate-500">{r.contactNumber}</div></div>) },
              { key: 'dev', header: 'Device', cell: (r) => (<div><div>{[r.brandName, r.deviceModelName].filter(Boolean).join(' ') || '—'}</div>{r.imei && <div className="font-mono text-xs text-slate-500">{r.imei}</div>}</div>) },
              { key: 'issue', header: 'Complaint', cell: (r) => <span className="line-clamp-2 max-w-xs">{r.complaint}</span> },
              { key: 'tech', header: 'Technician', cell: (r) => r.technicianName ?? '—' },
              { key: 'exp', header: 'Expected', cell: (r) => formatDate(r.expectedDeliveryAt) },
              { key: 'amt', header: 'Estimate', align: 'right', cell: (r) => formatMoney(r.estimate.total || r.estimatedCost) },
              { key: 'adv', header: 'Advance', align: 'right', cell: (r) => (r.advancePaid ? formatMoney(r.advancePaid) : '—') },
              { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      </div>
      <WarrantyLookupModal open={warranty} onClose={() => setWarranty(false)} />
    </>
  );
}
