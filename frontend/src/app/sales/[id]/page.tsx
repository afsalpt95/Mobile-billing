'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Download, HandCoins, Printer, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { Badge, Card, ErrorState, Spinner, StatusBadge } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Modal';
import { CustomerPaymentModal } from '@/features/payments/CustomerPaymentModal';
import { SalesReturnModal } from '@/features/returns/ReturnModals';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidate, usePaymentMethods } from '@/hooks/useCommon';
import { downloadFile, errorMessage } from '@/lib/api';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, formatNumber, openPrint, titleCase } from '@/lib/utils';
import { saleService } from '@/services';

export default function SaleDetailPage() {
  return (
    <AppShell permission="sales.read">
      <SaleDetail />
    </AppShell>
  );
}

function SaleDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const { data: methods = [] } = usePaymentMethods();
  const { data: sale, isLoading, error, refetch } = useQuery({ queryKey: qk.sale(id), queryFn: () => saleService.get(id) });
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [refundMethod, setRefundMethod] = useState('Cash');

  const cancelMut = useMutation({
    mutationFn: (reason: string) => saleService.cancel(id, { reason, refundMethod }),
    onSuccess: async () => {
      toast.success('Invoice cancelled and reversed');
      setCancel(false);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !sale) return <ErrorState error={error} onRetry={refetch} />;
  const active = sale.status === 'COMPLETED';
  const fullyReturned = sale.returnStatus === 'FULL';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Invoice {sale.invoiceNo} <StatusBadge status={sale.status} /> <StatusBadge status={sale.paymentStatus} />
            {sale.returnStatus !== 'NONE' && <Badge tone="red">{sale.returnStatus === 'FULL' ? 'Fully returned' : 'Partly returned'}</Badge>}
          </span>
        }
        crumbs={[{ label: 'Invoices', href: '/sales' }, { label: sale.invoiceNo }]}
        subtitle={`${formatDateTime(sale.date)} · by ${sale.createdBy?.name ?? '—'}`}
        actions={
          <>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPrint(`/print/invoice/${sale._id}?print=1`)}>
              Print
            </Button>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/sales/${sale._id}/pdf`, `${sale.invoiceNo}.pdf`).catch((e) => toast.error(errorMessage(e)))}>
              PDF
            </Button>
            {active && sale.balanceDue > 0 && can('customerPayments.create') && (
              <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setPay(true)}>
                Collect payment
              </Button>
            )}
            {active && !fullyReturned && can('returns.sales') && (
              <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRet(true)}>
                Return items
              </Button>
            )}
            {active && sale.returnStatus === 'NONE' && !sale.repairJob && can('sales.cancel') && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setCancel(true)}>
                Cancel invoice
              </Button>
            )}
          </>
        }
      />
      {sale.status === 'CANCELLED' && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Cancelled: {sale.cancelReason}. Stock and ledger effects were reversed; {formatMoney(sale.refundedAmount)} refunded.</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Items" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Discount</th>
                  <th className="text-right">Net</th>
                  {can('reports.financial') && <th className="text-right">Cost</th>}
                </tr>
              </thead>
              <tbody>
                {sale.items.map((i) => (
                  <tr key={i._id}>
                    <td>
                      <div className="font-medium">{i.name}</div>
                      <div className="space-x-2 text-xs text-slate-500">
                        {(i.device?.brandName || i.device?.deviceModelName) && <span>{[i.device?.brandName, i.device?.deviceModelName].join(' ')}</span>}
                        {i.device?.imei && <span>IMEI {i.device.imei}</span>}
                        {i.complaint && <span>Issue: {i.complaint}</span>}
                        {i.serials?.length > 0 && <span className="font-mono">{i.serials.join(', ')}</span>}
                        {i.sparePart?.name && <span>Spare: {i.sparePart.name} × {i.sparePart.qty}{i.sparePart.dealerName ? ` (${i.sparePart.dealerName})` : ''}</span>}
                        {i.warranty?.expiryDate && <span className="text-emerald-700">Warranty till {formatDate(i.warranty.expiryDate)}</span>}
                        {i.returnedQty > 0 && <span className="text-red-600">Returned {formatNumber(i.returnedQty)}</span>}
                      </div>
                    </td>
                    <td>{i.category ?? titleCase(i.revenueType)}</td>
                    <td className="text-right">{formatNumber(i.qty)}</td>
                    <td className="text-right">{formatMoney(i.unitPrice)}</td>
                    <td className="text-right">{i.discount ? formatMoney(i.discount) : '—'}</td>
                    <td className="text-right font-medium">{formatMoney(i.netTotal)}</td>
                    {can('reports.financial') && <td className="text-right text-slate-500">{formatMoney(i.costTotal)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Customer">
            <Link href={`/customers/${sale.customer}`} className="font-medium text-brand-700 hover:underline">
              {sale.customerName}
            </Link>
            <div className="text-sm text-slate-500">{sale.customerMobile}</div>
            {sale.repairJob && (
              <Link href={`/repairs/${sale.repairJob}`} className="mt-2 block text-sm text-brand-700 hover:underline">
                View repair job →
              </Link>
            )}
          </Card>
          <Card title="Totals">
            <dl className="space-y-1 text-sm">
              <Line k="Subtotal" v={formatMoney(sale.subtotal)} />
              <Line k="Item discounts" v={`- ${formatMoney(sale.itemDiscount)}`} />
              <Line k="Bill discount" v={`- ${formatMoney(sale.billDiscount)}`} />
              {sale.taxAmount > 0 && <Line k="Tax" v={formatMoney(sale.taxAmount)} />}
              <Line k="Grand total" v={formatMoney(sale.grandTotal)} strong />
              <Line k="Amount paid" v={formatMoney(sale.amountPaid)} />
              {sale.returnedAmount > 0 && <Line k="Returned value" v={formatMoney(sale.returnedAmount)} />}
              {sale.refundedAmount > 0 && <Line k="Refunded" v={formatMoney(sale.refundedAmount)} />}
              <Line k="Balance due" v={formatMoney(sale.balanceDue)} strong />
              {sale.changeDue > 0 && <Line k="Change given" v={formatMoney(sale.changeDue)} />}
              {sale.dueDate && sale.balanceDue > 0 && <Line k="Due date" v={formatDate(sale.dueDate)} />}
              {can('reports.financial') && <Line k="Gross margin" v={formatMoney(sale.grandTotal - sale.taxAmount - sale.costTotal)} />}
            </dl>
            {sale.notes && <p className="mt-2 text-xs text-slate-500">Notes: {sale.notes}</p>}
          </Card>
          <Card title="Payments & refunds" bodyClassName="p-0">
            {!sale.payments?.length ? (
              <p className="p-4 text-sm text-slate-500">No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {sale.payments.map((p) => (
                  <li key={p._id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <div>
                      <a href={`/print/receipt/${p._id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                        {p.receiptNo}
                      </a>
                      <div className="text-xs text-slate-500">
                        {formatDateTime(p.date)} · {p.methods.map((m) => m.method).join(' + ')} {p.status === 'CANCELLED' && '· cancelled'}
                      </div>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={p.type} />
                      <div className={p.type === 'REFUND' ? 'text-red-600' : ''}>{formatMoney(p.allocations.find((a) => a.sale === sale._id)?.amount ?? p.amount)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {sale.returns && sale.returns.length > 0 && (
            <Card title="Returns" bodyClassName="p-0">
              <ul className="divide-y divide-slate-100">
                {sale.returns.map((r) => (
                  <li key={r._id} className="px-4 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{r.returnNo}</span>
                      <span>{formatMoney(r.totalAmount)}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(r.date)} · {r.items.map((i) => `${i.name} × ${i.qty}${i.restock ? '' : ' (damaged)'}`).join(', ')} · {r.reason}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <CustomerPaymentModal open={pay} onClose={() => setPay(false)} customer={sale.customerDetails} saleId={sale._id} />
      {ret && <SalesReturnModal sale={sale} open={ret} onClose={() => setRet(false)} />}
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        title={`Cancel invoice ${sale.invoiceNo}?`}
        message={`Stock will be returned, the invoice reversed on the customer ledger and ${formatMoney(sale.amountPaid)} refunded. The invoice is kept for audit.`}
        confirmLabel="Cancel invoice"
        requireReason
        loading={cancelMut.isPending}
        onConfirm={(reason) => cancelMut.mutate(reason)}
      >
        {sale.amountPaid > 0 && (
          <Field label="Refund method">
            <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              {methods.map((m) => (
                <option key={m._id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </ConfirmDialog>
    </>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-slate-100 pt-1 font-semibold' : ''}`}>
      <dt className="text-slate-600">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
