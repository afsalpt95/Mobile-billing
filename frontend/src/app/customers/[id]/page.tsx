'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { HandCoins, Pencil, ShoppingCart, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, DataTable, ErrorState, Spinner, StatCard, StatusBadge, Tabs } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Modal';
import { LedgerView } from '@/features/ledger/LedgerView';
import { CustomerFormModal } from '@/features/masters/QuickCreate';
import { CustomerPaymentModal } from '@/features/payments/CustomerPaymentModal';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidate } from '@/hooks/useCommon';
import { errorMessage } from '@/lib/api';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney } from '@/lib/utils';
import { customerPaymentService, customerService } from '@/services';
import type { CustomerPayment, RepairJob, Sale } from '@/types';

type Tab = 'invoices' | 'repairs' | 'payments' | 'warranty' | 'ledger';

export default function CustomerDetailPage() {
  return (
    <AppShell permission="customers.read">
      <CustomerDetail />
    </AppShell>
  );
}

function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<Tab>('invoices');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [cancelPayment, setCancelPayment] = useState<CustomerPayment | null>(null);
  const { data: c, isLoading, error, refetch } = useQuery({ queryKey: qk.customer(id), queryFn: () => customerService.get(id) });
  const history = useQuery({ queryKey: [...qk.customer(id), 'history'], queryFn: () => customerService.history(id) });
  const warranties = useQuery({ queryKey: [...qk.customer(id), 'warranties'], queryFn: () => customerService.warranties(id), enabled: tab === 'warranty' });

  const cancelMut = useMutation({
    mutationFn: ({ pid, reason }: { pid: string; reason: string }) => customerPaymentService.cancel(pid, reason),
    onSuccess: async () => {
      toast.success('Payment cancelled and reversed');
      setCancelPayment(null);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !c) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title={c.name}
        crumbs={[{ label: 'Customers', href: '/customers' }, { label: c.name }]}
        subtitle={[c.mobile, c.altMobile, c.email].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('customers.write') && !c.isWalkIn && (
              <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>
                Edit
              </Button>
            )}
            {c.balance > 0 && can('customerPayments.create') && (
              <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setPay(true)}>
                Receive payment
              </Button>
            )}
            {can('sales.create') && (
              <Link href="/billing">
                <Button variant="outline" icon={<ShoppingCart className="h-4 w-4" />}>
                  New sale
                </Button>
              </Link>
            )}
            {can('repairs.write') && !c.isWalkIn && (
              <Link href={`/repairs/new?customer=${c._id}`}>
                <Button variant="outline" icon={<Wrench className="h-4 w-4" />}>
                  New repair
                </Button>
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Total purchases" value={formatMoney(c.totalSales)} tone="indigo" />
        <StatCard label="Total payments" value={formatMoney(c.totalPaid)} tone="green" />
        <StatCard label={c.balance < 0 ? 'Advance held' : 'Outstanding'} value={formatMoney(Math.abs(c.balance))} tone={c.balance > 0 ? 'amber' : 'slate'} sub={c.stats ? `${c.stats.openInvoices} open invoice(s)` : undefined} />
        <StatCard label="Overdue" value={formatMoney(c.stats?.overdue)} tone={c.stats?.overdue ? 'red' : 'slate'} />
        <StatCard label="Repairs" value={c.stats?.repairs ?? 0} tone="teal" sub={`Last purchase ${formatDate(c.lastPurchaseAt)}`} />
      </div>
      {(c.address || c.notes) && (
        <Card className="mb-4">
          {c.address && <p className="text-sm whitespace-pre-line text-slate-700">{c.address}</p>}
          {c.notes && <p className="mt-1 text-sm text-slate-500">{c.notes}</p>}
        </Card>
      )}
      <div className="card">
        <Tabs<Tab>
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'invoices', label: 'Invoices' },
            { value: 'repairs', label: 'Repairs' },
            { value: 'payments', label: 'Payments' },
            { value: 'warranty', label: 'Warranty' },
            { value: 'ledger', label: 'Credit ledger / statement' },
          ]}
        />
        {tab === 'invoices' && (
          <DataTable<Sale>
            loading={history.isLoading}
            rows={history.data?.sales}
            onRowClick={(s) => router.push(`/sales/${s._id}`)}
            columns={[
              { key: 'no', header: 'Invoice', cell: (s) => <span className="font-medium text-brand-700">{s.invoiceNo}</span> },
              { key: 'date', header: 'Date', cell: (s) => formatDate(s.date) },
              { key: 'total', header: 'Total', align: 'right', cell: (s) => formatMoney(s.grandTotal) },
              { key: 'paid', header: 'Paid', align: 'right', cell: (s) => formatMoney(s.amountPaid) },
              { key: 'due', header: 'Balance', align: 'right', cell: (s) => formatMoney(s.balanceDue) },
              { key: 'st', header: 'Status', cell: (s) => (<div className="flex gap-1"><StatusBadge status={s.paymentStatus} />{s.status === 'CANCELLED' && <StatusBadge status="CANCELLED" />}</div>) },
            ]}
          />
        )}
        {tab === 'repairs' && (
          <DataTable<RepairJob>
            loading={history.isLoading}
            rows={history.data?.repairs}
            onRowClick={(r) => router.push(`/repairs/${r._id}`)}
            columns={[
              { key: 'no', header: 'Job', cell: (r) => <span className="font-medium text-brand-700">{r.jobNo}</span> },
              { key: 'date', header: 'Received', cell: (r) => formatDate(r.receivedAt) },
              { key: 'dev', header: 'Device', cell: (r) => [r.brandName, r.deviceModelName].filter(Boolean).join(' ') || '—' },
              { key: 'issue', header: 'Complaint', cell: (r) => <span className="line-clamp-1">{r.complaint}</span> },
              { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { key: 'w', header: 'Warranty till', cell: (r) => formatDate(r.warrantyExpiry) },
            ]}
          />
        )}
        {tab === 'payments' && (
          <DataTable<CustomerPayment>
            loading={history.isLoading}
            rows={history.data?.payments}
            columns={[
              { key: 'no', header: 'Receipt', cell: (p) => <a className="font-medium text-brand-700 hover:underline" href={`/print/receipt/${p._id}`} target="_blank" rel="noreferrer">{p.receiptNo}</a> },
              { key: 'date', header: 'Date', cell: (p) => formatDateTime(p.date) },
              { key: 'type', header: 'Type', cell: (p) => <StatusBadge status={p.type} /> },
              { key: 'm', header: 'Method', cell: (p) => p.methods.map((m) => m.method).join(' + ') },
              { key: 'alloc', header: 'Applied to', cell: (p) => p.allocations.map((a) => a.invoiceNo).join(', ') || (p.unallocated ? 'Advance' : '—') },
              { key: 'amt', header: 'Amount', align: 'right', cell: (p) => <span className={p.type === 'REFUND' ? 'text-red-600' : ''}>{formatMoney(p.amount)}</span> },
              { key: 'st', header: '', cell: (p) => (p.status === 'CANCELLED' ? <StatusBadge status="CANCELLED" /> : p.type === 'RECEIPT' && can('customerPayments.cancel') ? <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelPayment(p)}>Cancel</Button> : null) },
            ]}
          />
        )}
        {tab === 'warranty' && (
          <DataTable
            loading={warranties.isLoading}
            rows={warranties.data}
            empty={<p className="p-6 text-center text-sm text-slate-500">No items with warranty.</p>}
            columns={[
              { key: 'item', header: 'Item / service', cell: (w) => <span className="font-medium">{w.name}</span> },
              { key: 'inv', header: 'Invoice', cell: (w) => <Link className="text-brand-700 hover:underline" href={`/sales/${w.saleId}`}>{w.invoiceNo}</Link> },
              { key: 'sn', header: 'IMEI / serial', cell: (w) => <span className="font-mono text-xs">{w.serials?.join(', ') || '—'}</span> },
              { key: 'start', header: 'Start', cell: (w) => formatDate(w.startDate) },
              { key: 'end', header: 'Expiry', cell: (w) => formatDate(w.expiryDate) },
              { key: 'st', header: 'Status', cell: (w) => <StatusBadge status={w.active ? 'ACTIVE' : 'CANCELLED'} label={w.active ? 'Under warranty' : 'Expired / returned'} /> },
            ]}
          />
        )}
        {tab === 'ledger' && <LedgerView kind="customer" id={id} />}
      </div>
      <CustomerFormModal open={edit} onClose={() => setEdit(false)} customer={c} onSaved={() => refetch()} />
      <CustomerPaymentModal open={pay} onClose={() => setPay(false)} customer={c} />
      <ConfirmDialog
        open={!!cancelPayment}
        onClose={() => setCancelPayment(null)}
        title={`Cancel receipt ${cancelPayment?.receiptNo}?`}
        message={`The ${formatMoney(cancelPayment?.amount)} will be removed from the invoices it was applied to and the customer balance will increase.`}
        confirmLabel="Cancel receipt"
        requireReason
        loading={cancelMut.isPending}
        onConfirm={(reason) => cancelPayment && cancelMut.mutate({ pid: cancelPayment._id, reason })}
      />
    </>
  );
}
