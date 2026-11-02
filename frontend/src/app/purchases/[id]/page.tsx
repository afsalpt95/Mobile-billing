'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Copy, Landmark, PackageCheck, Pencil, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Card, ErrorState, Spinner, StatusBadge } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Modal';
import { VendorPaymentModal } from '@/features/payments/VendorPaymentModal';
import { PurchaseReturnModal } from '@/features/returns/ReturnModals';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidate } from '@/hooks/useCommon';
import { errorMessage } from '@/lib/api';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/utils';
import { purchaseService } from '@/services';

export default function PurchaseDetailPage() {
  return (
    <AppShell permission="purchases.read">
      <PurchaseDetail />
    </AppShell>
  );
}

function PurchaseDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: qk.purchase(id), queryFn: () => purchaseService.get(id) });
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const [confirm, setConfirm] = useState<'receive' | 'cancel' | null>(null);

  const receive = useMutation({
    mutationFn: () => purchaseService.receive(id),
    onSuccess: async () => {
      toast.success('Purchase received — stock and vendor payable updated');
      setConfirm(null);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 6000 }),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => purchaseService.cancel(id, reason),
    onSuccess: async () => {
      toast.success('Purchase cancelled and reversed');
      setConfirm(null);
      await invalidate(...financialKeys);
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 6000 }),
  });
  const duplicate = useMutation({
    mutationFn: () => purchaseService.duplicate(id),
    onSuccess: async (d) => {
      toast.success(`Draft ${d.purchaseNo} created`);
      await invalidate(qk.purchases);
      router.push(`/purchases/${d._id}/edit`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !p) return <ErrorState error={error} onRetry={refetch} />;
  const received = p.status === 'RECEIVED';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Purchase {p.purchaseNo} <StatusBadge status={p.status} /> {received && <StatusBadge status={p.paymentStatus} />}
            {p.returnStatus !== 'NONE' && <StatusBadge status="FULL" label={`${titleCase(p.returnStatus)} return`} />}
          </span>
        }
        crumbs={[{ label: 'Purchases', href: '/purchases' }, { label: p.purchaseNo }]}
        subtitle={`${formatDate(p.date)}${p.vendorInvoiceNo ? ` · Vendor invoice ${p.vendorInvoiceNo}` : ''}`}
        actions={
          <>
            {p.status === 'DRAFT' && can('purchases.write') && (
              <>
                <Link href={`/purchases/${p._id}/edit`}>
                  <Button variant="outline" icon={<Pencil className="h-4 w-4" />}>
                    Edit draft
                  </Button>
                </Link>
                <Button icon={<PackageCheck className="h-4 w-4" />} onClick={() => setConfirm('receive')}>
                  Receive stock
                </Button>
              </>
            )}
            {received && p.balanceDue > 0 && can('vendorPayments.create') && (
              <Button icon={<Landmark className="h-4 w-4" />} onClick={() => setPay(true)}>
                Pay
              </Button>
            )}
            {received && p.returnStatus !== 'FULL' && can('returns.purchases') && (
              <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRet(true)}>
                Return to vendor
              </Button>
            )}
            {can('purchases.write') && p.status !== 'DRAFT' && (
              <Button variant="outline" icon={<Copy className="h-4 w-4" />} onClick={() => duplicate.mutate()} loading={duplicate.isPending}>
                Copy to new draft
              </Button>
            )}
            {p.status !== 'CANCELLED' && p.returnStatus === 'NONE' && can('purchases.cancel') && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('cancel')}>
                Cancel
              </Button>
            )}
          </>
        }
      />
      {p.status === 'CANCELLED' && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Cancelled: {p.cancelReason}. Stock and payable were reversed; any amount paid was moved to the vendor advance.</div>}
      {p.status === 'DRAFT' && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Draft — stock and vendor payable are not affected until you receive this purchase.</div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Items" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Free</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">Discount</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Line total</th>
                  <th className="text-right">Landed/unit</th>
                  <th className="text-right">Returned</th>
                </tr>
              </thead>
              <tbody>
                {p.items.map((i) => (
                  <tr key={i._id}>
                    <td>
                      <Link href={`/inventory/products/${i.product}`} className="font-medium hover:text-brand-700">
                        {i.name}
                      </Link>
                      {i.sku && <div className="text-xs text-slate-500">SKU {i.sku}</div>}
                      {i.serials?.length > 0 && <div className="font-mono text-xs text-slate-500">{i.serials.join(', ')}</div>}
                    </td>
                    <td className="text-right">{formatNumber(i.qty)}</td>
                    <td className="text-right">{i.freeQty ? formatNumber(i.freeQty) : '—'}</td>
                    <td className="text-right">{formatMoney(i.unitCost)}</td>
                    <td className="text-right">{i.discount ? formatMoney(i.discount) : '—'}</td>
                    <td className="text-right">{i.taxAmount ? `${formatMoney(i.taxAmount)} (${i.taxRate}%)` : '—'}</td>
                    <td className="text-right font-medium">{formatMoney(i.lineTotal + i.taxAmount)}</td>
                    <td className="text-right text-slate-500">{formatMoney(i.landedUnitCost)}</td>
                    <td className="text-right">{i.returnedQty ? formatNumber(i.returnedQty) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Vendor">
            <Link href={`/vendors/${p.vendor}`} className="font-medium text-brand-700 hover:underline">
              {p.vendorName}
            </Link>
            <div className="text-sm text-slate-500">{p.vendorDetails?.mobile}</div>
            {p.paymentTerms && <div className="mt-1 text-sm">Terms: {p.paymentTerms}</div>}
            {p.dueDate && <div className="text-sm">Due: {formatDate(p.dueDate)}</div>}
            {p.attachmentRef && <div className="text-sm">Attachment: {p.attachmentRef}</div>}
          </Card>
          <Card title="Totals">
            <dl className="space-y-1 text-sm">
              <L k="Subtotal" v={formatMoney(p.subtotal)} />
              <L k="Discount" v={`- ${formatMoney(p.discount)}`} />
              <L k="Tax" v={formatMoney(p.taxAmount)} />
              <L k="Shipping / other" v={formatMoney(p.shippingCharges + p.otherCharges)} />
              <L k="Grand total" v={formatMoney(p.grandTotal)} strong />
              {received && (
                <>
                  <L k="Paid" v={formatMoney(p.amountPaid)} />
                  {p.returnedAmount > 0 && <L k="Returned (credit)" v={formatMoney(p.returnedAmount)} />}
                  <L k="Balance payable" v={formatMoney(p.balanceDue)} strong />
                </>
              )}
              {p.status === 'DRAFT' && p.initialPayment?.amount ? <L k="To pay on receipt" v={`${formatMoney(p.initialPayment.amount)} (${p.initialPayment.method})`} /> : null}
            </dl>
            {p.notes && <p className="mt-2 text-xs text-slate-500">{p.notes}</p>}
          </Card>
          {p.payments && p.payments.length > 0 && (
            <Card title="Payments" bodyClassName="p-0">
              <ul className="divide-y divide-slate-100">
                {p.payments.map((v) => (
                  <li key={v._id} className="flex justify-between px-4 py-2 text-sm">
                    <div>
                      <a href={`/print/vendor-payment/${v._id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                        {v.paymentNo}
                      </a>
                      <div className="text-xs text-slate-500">
                        {formatDateTime(v.date)} · {v.method} {v.status === 'CANCELLED' && '· cancelled'}
                      </div>
                    </div>
                    <span>{formatMoney(v.allocations.find((a) => a.purchase === p._id)?.amount ?? v.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {p.returns && p.returns.length > 0 && (
            <Card title="Vendor returns" bodyClassName="p-0">
              <ul className="divide-y divide-slate-100">
                {p.returns.map((r) => (
                  <li key={r._id} className="px-4 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{r.returnNo}</span>
                      <span>{formatMoney(r.totalAmount)}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatDate(r.date)} · {titleCase(r.settlement)} · {r.reason}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <VendorPaymentModal open={pay} onClose={() => setPay(false)} vendor={p.vendorDetails} purchaseId={p._id} />
      {ret && <PurchaseReturnModal purchase={p} open={ret} onClose={() => setRet(false)} />}
      <ConfirmDialog
        open={confirm === 'receive'}
        onClose={() => setConfirm(null)}
        danger={false}
        title="Receive this purchase?"
        message={`Stock will be added at landed cost and ${formatMoney(p.grandTotal)} posted to ${p.vendorName}'s payable${p.initialPayment?.amount ? `, with ${formatMoney(p.initialPayment.amount)} paid now` : ''}.`}
        confirmLabel="Receive"
        loading={receive.isPending}
        onConfirm={() => receive.mutate()}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title={`Cancel purchase ${p.purchaseNo}?`}
        message={received ? 'The received stock will be removed (it must still be in stock), the payable reversed and any amount paid kept as a vendor advance.' : 'The draft will be marked cancelled.'}
        confirmLabel="Cancel purchase"
        requireReason
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
    </>
  );
}

function L({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-slate-100 pt-1 font-semibold' : ''}`}>
      <dt className="text-slate-600">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
