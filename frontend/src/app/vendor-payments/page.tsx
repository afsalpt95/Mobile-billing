'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Landmark, Printer, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, MoneyInput, Select } from '@/components/ui/Field';
import { DataTable, ErrorState, Pagination, SearchInput, StatCard, StatusBadge, Tabs } from '@/components/ui/Misc';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { VendorPaymentModal } from '@/features/payments/VendorPaymentModal';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce, useInvalidate, usePaymentMethods } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { add } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, openPrint, titleCase } from '@/lib/utils';
import { vendorPaymentService, vendorService, type VendorCreditRow } from '@/services';
import type { Vendor, VendorPayment } from '@/types';

export default function VendorPaymentsPage() {
  return (
    <AppShell permission="vendorPayments.read">
      <VendorPayments />
    </AppShell>
  );
}

function VendorPayments() {
  const router = useRouter();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<'payables' | 'history'>('payables');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pay, setPay] = useState<{ vendor?: Vendor; mode: 'PAY' | 'APPLY_ADVANCE' } | null>(null);
  const [refundFor, setRefundFor] = useState<VendorCreditRow | null>(null);
  const [cancel, setCancel] = useState<VendorPayment | null>(null);
  const search = useDebounce(q, 300);
  const credit = useQuery({ queryKey: [...qk.vendorCredit, search], queryFn: () => vendorService.credit(search) });
  const history = useQuery({
    queryKey: [...qk.payments, 'vendor-history', search, page],
    queryFn: () => vendorPaymentService.list({ q: search, page, limit: 25 }),
    enabled: tab === 'history',
    placeholderData: keepPreviousData,
  });
  const rows = credit.data ?? [];

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => vendorPaymentService.cancel(id, reason),
    onSuccess: async () => {
      toast.success('Payment cancelled; purchase balances restored');
      setCancel(null);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openPay = async (row: VendorCreditRow, mode: 'PAY' | 'APPLY_ADVANCE') => setPay({ vendor: await vendorService.get(row._id), mode });

  return (
    <>
      <PageHeader
        title="Vendor Credit & Payments"
        crumbs={[{ label: 'Vendor Payments' }]}
        subtitle="Credit purchases appear here automatically. Payments are allocated to purchase invoices."
        actions={
          can('vendorPayments.create') && (
            <Button icon={<Landmark className="h-4 w-4" />} onClick={() => setPay({ mode: 'PAY' })}>
              Pay vendor credit
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total payable" value={formatMoney(add(...rows.map((r) => r.outstanding)))} tone="amber" loading={credit.isLoading} />
        <StatCard label="Overdue" value={formatMoney(add(...rows.map((r) => r.overdue)))} tone="red" loading={credit.isLoading} />
        <StatCard label="Vendors with dues" value={rows.filter((r) => r.outstanding > 0).length} tone="indigo" loading={credit.isLoading} />
        <StatCard label="Advances with vendors" value={formatMoney(add(...rows.map((r) => r.advanceBalance)))} tone="teal" loading={credit.isLoading} />
      </div>
      <div className="card">
        <Tabs
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'payables', label: 'Payables by vendor' },
            { value: 'history', label: 'Payment history' },
          ]}
        />
        <div className="border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={tab === 'payables' ? 'Search vendor…' : 'Voucher no, vendor, reference…'} className="w-full sm:w-80" />
        </div>
        {tab === 'payables' &&
          (credit.error ? (
            <ErrorState error={credit.error} onRetry={credit.refetch} />
          ) : (
            <DataTable<VendorCreditRow>
              loading={credit.isLoading}
              rows={rows}
              onRowClick={(r) => router.push(`/vendors/${r._id}`)}
              empty={<p className="p-8 text-center text-sm text-slate-500">No outstanding vendor credit.</p>}
              columns={[
                { key: 'name', header: 'Vendor', cell: (r) => (<div><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.mobile}</div></div>) },
                { key: 'tp', header: 'Total purchases', align: 'right', cell: (r) => formatMoney(r.totalPurchases) },
                { key: 'paid', header: 'Total paid', align: 'right', cell: (r) => formatMoney(r.totalPaid) },
                { key: 'out', header: 'Outstanding', align: 'right', cell: (r) => <span className="font-semibold text-amber-700">{formatMoney(r.outstanding)}</span> },
                { key: 'over', header: 'Overdue', align: 'right', cell: (r) => <span className={r.overdue ? 'font-medium text-red-600' : ''}>{formatMoney(r.overdue)}</span> },
                { key: 'old', header: 'Oldest unpaid', cell: (r) => (r.oldestUnpaid ? `${r.oldestUnpaid.purchaseNo} · ${formatDate(r.oldestUnpaid.date)}` : '—') },
                { key: 'next', header: 'Next due', cell: (r) => formatDate(r.nextDueDate) },
                { key: 'last', header: 'Last payment', cell: (r) => formatDate(r.lastPaymentAt) },
                { key: 'adv', header: 'Advance', align: 'right', cell: (r) => (r.advanceBalance ? <span className="text-teal-700">{formatMoney(r.advanceBalance)}</span> : '—') },
                {
                  key: 'act',
                  header: '',
                  cell: (r) =>
                    can('vendorPayments.create') && (
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {r.outstanding > 0 && (
                          <Button size="sm" onClick={() => void openPay(r, 'PAY')}>
                            Pay
                          </Button>
                        )}
                        {r.advanceBalance > 0 && r.outstanding > 0 && (
                          <Button size="sm" variant="outline" onClick={() => void openPay(r, 'APPLY_ADVANCE')}>
                            Use advance
                          </Button>
                        )}
                        {r.advanceBalance > 0 && (
                          <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setRefundFor(r)}>
                            Refund
                          </Button>
                        )}
                      </div>
                    ),
                },
              ]}
            />
          ))}
        {tab === 'history' && (
          <>
            <DataTable<VendorPayment>
              loading={history.isLoading}
              rows={history.data?.items}
              columns={[
                { key: 'no', header: 'Voucher', cell: (p) => <span className="font-medium">{p.paymentNo}</span> },
                { key: 'date', header: 'Date', cell: (p) => formatDateTime(p.date) },
                { key: 'v', header: 'Vendor', cell: (p) => p.vendorName },
                { key: 't', header: 'Type', cell: (p) => <StatusBadge status={p.type} label={titleCase(p.type)} /> },
                { key: 'm', header: 'Method / ref', cell: (p) => [p.method, p.reference].filter(Boolean).join(' · ') },
                { key: 'a', header: 'Allocated to', cell: (p) => p.allocations.map((a) => `${a.purchaseNo} (${formatMoney(a.amount)})`).join(', ') || '—' },
                { key: 'adv', header: 'To advance', align: 'right', cell: (p) => (p.advanceAmount ? formatMoney(p.advanceAmount) : '—') },
                { key: 'amt', header: 'Amount', align: 'right', cell: (p) => <span className="font-medium">{formatMoney(p.amount)}</span> },
                {
                  key: 'act',
                  header: '',
                  cell: (p) => (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => openPrint(`/print/vendor-payment/${p._id}`)}>
                        Receipt
                      </Button>
                      {p.status === 'CANCELLED' ? (
                        <StatusBadge status="CANCELLED" />
                      ) : (
                        p.type === 'PAYMENT' &&
                        can('vendorPayments.cancel') && (
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancel(p)}>
                            Cancel
                          </Button>
                        )
                      )}
                    </div>
                  ),
                },
              ]}
            />
            {history.data && <Pagination page={history.data.page} pages={history.data.pages} total={history.data.total} onPage={setPage} />}
          </>
        )}
      </div>
      <VendorPaymentModal open={!!pay} mode={pay?.mode} vendor={pay?.vendor} onClose={() => setPay(null)} />
      <VendorRefundModal row={refundFor} onClose={() => setRefundFor(null)} />
      <ConfirmDialog
        open={!!cancel}
        onClose={() => setCancel(null)}
        title={`Cancel payment ${cancel?.paymentNo}?`}
        message={`${formatMoney(cancel?.amount)} will be removed from the purchases it was applied to, restoring the vendor's payable. The voucher is kept for audit.`}
        confirmLabel="Cancel payment"
        requireReason
        loading={cancelMut.isPending}
        onConfirm={(reason) => cancel && cancelMut.mutate({ id: cancel._id, reason })}
      />
    </>
  );
}

function VendorRefundModal({ row, onClose }: { row: VendorCreditRow | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const { data: methods = [] } = usePaymentMethods();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const save = useMutation({
    mutationFn: () => vendorPaymentService.refund({ clientRequestId: newRequestId(), vendorId: row!._id, amount: Number(amount), method }),
    onSuccess: async () => {
      toast.success('Vendor refund recorded');
      setAmount('');
      await invalidate(...financialKeys);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="sm"
      title={`Refund received from ${row?.name}`}
      description={`Advance / credit notes held: ${formatMoney(row?.advanceBalance)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!(Number(amount) > 0) || Number(amount) > (row?.advanceBalance ?? 0)}>
            Record refund
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount received">
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus />
        </Field>
        <Field label="Received by">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((m) => (
              <option key={m._id} value={m.name}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
