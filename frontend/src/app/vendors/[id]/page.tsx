'use client';

import { useQuery } from '@tanstack/react-query';
import { Landmark, PackagePlus, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, DataTable, ErrorState, Spinner, StatCard, StatusBadge, Tabs } from '@/components/ui/Misc';
import { LedgerView } from '@/features/ledger/LedgerView';
import { VendorFormModal } from '@/features/masters/QuickCreate';
import { VendorPaymentModal } from '@/features/payments/VendorPaymentModal';
import { useAuth } from '@/hooks/useAuth';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/lib/utils';
import { purchaseService, vendorPaymentService, vendorService } from '@/services';
import type { Purchase, VendorPayment } from '@/types';

type Tab = 'purchases' | 'payments' | 'ledger';

export default function VendorDetailPage() {
  return (
    <AppShell permission="vendors.read">
      <VendorDetail />
    </AppShell>
  );
}

function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('purchases');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState<'PAY' | 'APPLY_ADVANCE' | null>(null);
  const { data: v, isLoading, error, refetch } = useQuery({ queryKey: qk.vendor(id), queryFn: () => vendorService.get(id) });
  const canFinance = can('vendorPayments.read');
  const purchases = useQuery({ queryKey: [...qk.purchases, 'vendor', id], queryFn: () => purchaseService.list({ vendor: id, limit: 100 }), enabled: can('purchases.read') });
  const payments = useQuery({ queryKey: [...qk.payments, 'vendor', id], queryFn: () => vendorPaymentService.list({ vendor: id, limit: 100 }), enabled: canFinance && tab === 'payments' });

  if (isLoading) return <Spinner />;
  if (error || !v) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={v.name}
        crumbs={[{ label: 'Vendors', href: '/vendors' }, { label: v.name }]}
        subtitle={[v.contactPerson, v.mobile, v.email, v.taxId && `Tax ID ${v.taxId}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('vendors.write') && (
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>
                Edit
              </Button>
            )}
            {can('purchases.write') && (
              <Link href={`/purchases/new?vendor=${v._id}`}>
                <Button variant="outline" icon={<PackagePlus className="h-4 w-4" />}>
                  New purchase
                </Button>
              </Link>
            )}
            {v.advanceBalance > 0 && v.balance > 0 && can('vendorPayments.create') && (
              <Button variant="outline" onClick={() => setPay('APPLY_ADVANCE')}>
                Apply advance
              </Button>
            )}
            {can('vendorPayments.create') && (
              <Button icon={<Landmark className="h-4 w-4" />} onClick={() => setPay('PAY')}>
                Pay vendor
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total purchases" value={formatMoney(v.totalPurchases)} tone="indigo" />
        <StatCard label="Total paid" value={formatMoney(v.totalPaid)} tone="green" />
        <StatCard label="Outstanding payable" value={formatMoney(v.balance)} tone={v.balance > 0 ? 'amber' : 'slate'} sub={`${v.stats?.openInvoices ?? 0} unpaid purchase(s)`} />
        <StatCard label="Overdue" value={formatMoney(v.stats?.overdue)} tone={v.stats?.overdue ? 'red' : 'slate'} />
        <StatCard label="Advance / credit notes" value={formatMoney(v.advanceBalance)} tone="teal" sub={`Terms: ${v.paymentTermsDays} days`} />
      </div>
      {(v.address || v.notes) && (
        <Card className="mb-4">
          {v.address && <p className="text-sm whitespace-pre-line">{v.address}</p>}
          {v.notes && <p className="mt-1 text-sm text-slate-500">{v.notes}</p>}
        </Card>
      )}
      <div className="card">
        <Tabs<Tab>
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'purchases', label: 'Purchases' },
            ...(canFinance ? [{ value: 'payments' as Tab, label: 'Payments' }, { value: 'ledger' as Tab, label: 'Statement / ledger' }] : []),
          ]}
        />
        {tab === 'purchases' && (
          <DataTable<Purchase>
            loading={purchases.isLoading}
            rows={purchases.data?.items}
            onRowClick={(p) => router.push(`/purchases/${p._id}`)}
            columns={[
              { key: 'no', header: 'Purchase', cell: (p) => <span className="font-medium text-brand-700">{p.purchaseNo}</span> },
              { key: 'vi', header: 'Vendor invoice', cell: (p) => p.vendorInvoiceNo ?? '—' },
              { key: 'date', header: 'Date', cell: (p) => formatDate(p.date) },
              { key: 'due', header: 'Due', cell: (p) => formatDate(p.dueDate) },
              { key: 'total', header: 'Total', align: 'right', cell: (p) => formatMoney(p.grandTotal) },
              { key: 'bal', header: 'Balance', align: 'right', cell: (p) => formatMoney(p.balanceDue) },
              { key: 'st', header: 'Status', cell: (p) => (<div className="flex gap-1"><StatusBadge status={p.status} />{p.status === 'RECEIVED' && <StatusBadge status={p.paymentStatus} />}</div>) },
            ]}
          />
        )}
        {tab === 'payments' && (
          <DataTable<VendorPayment>
            loading={payments.isLoading}
            rows={payments.data?.items}
            columns={[
              { key: 'no', header: 'Voucher', cell: (p) => <a className="font-medium text-brand-700 hover:underline" href={`/print/vendor-payment/${p._id}`} target="_blank" rel="noreferrer">{p.paymentNo}</a> },
              { key: 'date', header: 'Date', cell: (p) => formatDateTime(p.date) },
              { key: 'type', header: 'Type', cell: (p) => <StatusBadge status={p.type} label={titleCase(p.type)} /> },
              { key: 'm', header: 'Method', cell: (p) => [p.method, p.reference].filter(Boolean).join(' · ') },
              { key: 'alloc', header: 'Applied to', cell: (p) => p.allocations.map((a) => a.purchaseNo).join(', ') || '—' },
              { key: 'amt', header: 'Amount', align: 'right', cell: (p) => formatMoney(p.amount) },
              { key: 'st', header: '', cell: (p) => p.status === 'CANCELLED' && <StatusBadge status="CANCELLED" /> },
            ]}
          />
        )}
        {tab === 'ledger' && <LedgerView kind="vendor" id={id} />}
      </div>
      <VendorFormModal open={edit} onClose={() => setEdit(false)} vendor={v} onSaved={() => refetch()} />
      <VendorPaymentModal open={pay !== null} mode={pay ?? 'PAY'} onClose={() => setPay(null)} vendor={v} />
    </>
  );
}
