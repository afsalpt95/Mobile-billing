'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, HandCoins, Pencil, Printer, Receipt, Truck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/Field';
import { Card, ErrorState, Spinner, StatusBadge } from '@/components/ui/Misc';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { CustomerPaymentModal } from '@/features/payments/CustomerPaymentModal';
import { PaymentRows, emptyPayRow, payRowsToApi, payRowsTotal, type PayRow } from '@/features/payments/PaymentRows';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidate, usePaymentMethods, useSettings } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { sub } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, formatNumber, openPrint, titleCase } from '@/lib/utils';
import { repairService } from '@/services';
import type { RepairStatus } from '@/types';

const WORKFLOW: RepairStatus[] = ['RECEIVED', 'DIAGNOSIS_PENDING', 'WAITING_APPROVAL', 'WAITING_PARTS', 'IN_PROGRESS'];

export default function RepairDetailPage() {
  return (
    <AppShell permission="repairs.read">
      <RepairDetail />
    </AppShell>
  );
}

function RepairDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const { data: settings } = useSettings();
  const { data: methods = [] } = usePaymentMethods();
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: qk.repair(id), queryFn: () => repairService.get(id) });
  const [statusNote, setStatusNote] = useState('');
  const [modal, setModal] = useState<'advance' | 'complete' | 'cancel' | 'collect' | null>(null);
  const [advance, setAdvance] = useState<PayRow[]>([emptyPayRow()]);
  const [completePay, setCompletePay] = useState<PayRow[]>([emptyPayRow()]);
  const [deliver, setDeliver] = useState(false);
  const [refundMethod, setRefundMethod] = useState('Cash');
  const completeRequest = useRef(newRequestId());

  useEffect(() => {
    if (settings?.billing?.defaultPaymentMethod) {
      setAdvance([emptyPayRow(settings.billing.defaultPaymentMethod)]);
      setRefundMethod(settings.billing.defaultPaymentMethod);
    }
  }, [settings]);

  const after = async (msg: string) => {
    toast.success(msg);
    setModal(null);
    setStatusNote('');
    await invalidate(...financialKeys);
  };
  const status = useMutation({
    mutationFn: (s: RepairStatus) => repairService.status(id, { status: s, note: statusNote || undefined }),
    onSuccess: (d) => after(`Status: ${titleCase(d.status)}`),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addAdvance = useMutation({
    mutationFn: () => repairService.advance(id, payRowsToApi(advance)),
    onSuccess: () => after('Advance recorded'),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const complete = useMutation({
    mutationFn: () => repairService.complete(id, { clientRequestId: completeRequest.current, payments: payRowsToApi(completePay), deliver, refundMethod }),
    onSuccess: async ({ data }) => {
      completeRequest.current = newRequestId();
      await after(`Job completed — invoice ${data.sale.invoiceNo}`);
      openPrint(`/print/invoice/${data.sale._id}`);
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 6000 }),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => repairService.status(id, { status: 'CANCELLED', note: reason, refundMethod }),
    onSuccess: () => after('Job cancelled; advance refunded'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !r) return <ErrorState error={error} onRetry={refetch} />;
  const open = WORKFLOW.includes(r.status);
  const estimateTotal = r.estimate.total;
  const dueOnCompletion = Math.max(0, sub(estimateTotal, r.advancePaid));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Job {r.jobNo} <StatusBadge status={r.status} />
          </span>
        }
        crumbs={[{ label: 'Repairs', href: '/repairs' }, { label: r.jobNo }]}
        subtitle={`Received ${formatDateTime(r.receivedAt)}${r.expectedDeliveryAt ? ` · expected ${formatDate(r.expectedDeliveryAt)}` : ''}`}
        actions={
          <>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPrint(`/print/repair/${r._id}?print=1`)}>
              Job receipt
            </Button>
            {open && can('repairs.write') && (
              <>
                <Link href={`/repairs/${r._id}/edit`}>
                  <Button variant="outline" icon={<Pencil className="h-4 w-4" />}>
                    Edit job
                  </Button>
                </Link>
                <Button variant="outline" icon={<Wallet className="h-4 w-4" />} onClick={() => setModal('advance')}>
                  Take advance
                </Button>
              </>
            )}
            {open && can('repairs.complete') && (
              <Button
                icon={<CheckCircle2 className="h-4 w-4" />}
                onClick={() => {
                  setCompletePay([{ ...emptyPayRow(settings?.billing?.defaultPaymentMethod), amount: dueOnCompletion ? String(dueOnCompletion) : '' }]);
                  setDeliver(false);
                  setModal('complete');
                }}
              >
                Complete &amp; invoice
              </Button>
            )}
            {r.status === 'READY_FOR_DELIVERY' && can('repairs.write') && (
              <Button icon={<Truck className="h-4 w-4" />} onClick={() => status.mutate('DELIVERED')} loading={status.isPending}>
                Mark delivered
              </Button>
            )}
            {r.sale && r.sale.balanceDue > 0 && can('customerPayments.create') && (
              <Button variant="outline" icon={<HandCoins className="h-4 w-4" />} onClick={() => setModal('collect')}>
                Collect balance
              </Button>
            )}
            {open && can('repairs.write') && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setModal('cancel')}>
                Cancel job
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Customer">
              <Link href={`/customers/${r.customer}`} className="font-medium text-brand-700 hover:underline">
                {r.customerName}
              </Link>
              <div className="text-sm text-slate-600">{r.contactNumber}</div>
            </Card>
            <Card title="Device">
              <div className="font-medium">{[r.brandName, r.deviceModelName].filter(Boolean).join(' ') || '—'}</div>
              <div className="text-sm text-slate-600">{r.deviceCategoryName}</div>
              {r.imei && <div className="font-mono text-sm">IMEI/SN {r.imei}</div>}
              {r.accessoriesReceived && <div className="text-sm text-slate-600">Accessories: {r.accessoriesReceived}</div>}
            </Card>
          </div>
          <Card title="Job details">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Item k="Complaint" v={r.complaint} />
              <Item k="Condition at receipt" v={r.conditionAtReceipt} />
              <Item k="Diagnosis" v={r.diagnosis} />
              <Item k="Technician" v={r.technicianName} />
              <Item k="Estimated / approved cost" v={`${formatMoney(r.estimatedCost)} / ${formatMoney(r.approvedCost)}`} />
              <Item k="Warranty" v={r.warrantyType === 'NONE' ? 'None' : `${titleCase(r.warrantyType)} · ${r.warrantyDays} days${r.warrantyExpiry ? ` (till ${formatDate(r.warrantyExpiry)})` : ''}`} />
              <Item k="Customer notes" v={r.customerNotes} />
              <Item k="Internal notes" v={r.internalNotes} />
            </dl>
          </Card>
          <Card title="Charges" bodyClassName="p-0">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Total</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Labour / service charge</td>
                  <td className="text-right">1</td>
                  <td className="text-right">{formatMoney(r.laborCharge)}</td>
                  <td className="text-right">{formatMoney(r.laborCharge)}</td>
                  <td />
                </tr>
                {r.parts.map((p) => (
                  <tr key={p._id}>
                    <td>{p.name}</td>
                    <td className="text-right">{formatNumber(p.qty)}</td>
                    <td className="text-right">{formatMoney(p.unitPrice)}</td>
                    <td className="text-right">{formatMoney(p.unitPrice * p.qty)}</td>
                    <td>{p.consumed ? <StatusBadge status="DELIVERED" label="Deducted" /> : <StatusBadge status="DRAFT" label="Reserved" />}</td>
                  </tr>
                ))}
                {r.discount > 0 && (
                  <tr>
                    <td colSpan={3}>Discount</td>
                    <td className="text-right">- {formatMoney(r.discount)}</td>
                    <td />
                  </tr>
                )}
                <tr className="font-semibold">
                  <td colSpan={3}>Total</td>
                  <td className="text-right">{formatMoney(estimateTotal)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Billing">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>Advance paid</dt><dd>{formatMoney(r.advancePaid)}</dd></div>
              {r.sale ? (
                <>
                  <div className="flex justify-between"><dt>Invoice</dt><dd><Link className="font-medium text-brand-700 hover:underline" href={`/sales/${r.sale._id}`}>{r.invoiceNo}</Link></dd></div>
                  <div className="flex justify-between"><dt>Invoice total</dt><dd>{formatMoney(r.sale.grandTotal)}</dd></div>
                  <div className="flex justify-between"><dt>Paid</dt><dd>{formatMoney(r.sale.amountPaid)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd>{formatMoney(r.sale.balanceDue)}</dd></div>
                </>
              ) : (
                <div className="flex justify-between font-semibold"><dt>Estimated balance</dt><dd>{formatMoney(r.estimate.balanceDue)}</dd></div>
              )}
            </dl>
            {r.payments && r.payments.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {r.payments.map((p) => (
                  <li key={p._id} className="flex justify-between py-1.5">
                    <a href={`/print/receipt/${p._id}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                      {p.receiptNo} <span className="text-xs text-slate-500">({titleCase(p.type)})</span>
                    </a>
                    <span className={p.type === 'REFUND' ? 'text-red-600' : ''}>{formatMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.sale && (
              <Button variant="outline" size="sm" className="mt-3 w-full" icon={<Receipt className="h-4 w-4" />} onClick={() => openPrint(`/print/invoice/${r.sale!._id}?print=1`)}>
                Print invoice
              </Button>
            )}
          </Card>
          {open && can('repairs.write') && (
            <Card title="Update status">
              <div className="space-y-2">
                <Textarea placeholder="Note (optional)" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} rows={2} />
                <div className="grid grid-cols-2 gap-2">
                  {WORKFLOW.filter((s) => s !== r.status).map((s) => (
                    <Button key={s} size="sm" variant="outline" onClick={() => status.mutate(s)} disabled={status.isPending}>
                      {titleCase(s)}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          )}
          <Card title="Status history">
            <ol className="relative space-y-3 border-l border-slate-200 pl-4 text-sm">
              {[...r.statusHistory].reverse().map((h, i) => (
                <li key={i}>
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
                  <div className="font-medium">{titleCase(h.status)}</div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(h.at)} · {h.byName}
                  </div>
                  {h.note && <div className="text-xs text-slate-600">{h.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={modal === 'advance'}
        onClose={() => setModal(null)}
        size="sm"
        title="Take advance payment"
        footer={
          <Button onClick={() => addAdvance.mutate()} loading={addAdvance.isPending} disabled={payRowsTotal(advance) <= 0}>
            Record advance
          </Button>
        }
      >
        <PaymentRows rows={advance} onChange={setAdvance} />
      </Modal>

      <Modal
        open={modal === 'complete'}
        onClose={() => setModal(null)}
        size="md"
        title="Complete job & generate invoice"
        description="Spare parts are deducted from stock now (once). Labour and parts are invoiced separately for reporting."
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(null)}>
              Back
            </Button>
            <Button onClick={() => complete.mutate()} loading={complete.isPending}>
              Complete &amp; invoice
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex justify-between"><span>Labour</span><span>{formatMoney(r.laborCharge)}</span></div>
            <div className="flex justify-between"><span>Spare parts</span><span>{formatMoney(r.estimate.partsTotal)}</span></div>
            {r.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>- {formatMoney(r.discount)}</span></div>}
            <div className="flex justify-between font-semibold"><span>Invoice total{settings?.tax?.enabled ? ' (before tax)' : ''}</span><span>{formatMoney(estimateTotal)}</span></div>
            <div className="flex justify-between"><span>Advance applied</span><span>- {formatMoney(Math.min(r.advancePaid, estimateTotal))}</span></div>
            <div className="flex justify-between font-semibold text-amber-700"><span>To collect</span><span>{formatMoney(dueOnCompletion)}</span></div>
            {r.advancePaid > estimateTotal && <div className="text-xs text-red-600">Excess advance {formatMoney(r.advancePaid - estimateTotal)} will be refunded.</div>}
          </div>
          <Field label="Payment now (leave 0 to keep as customer credit)">
            <PaymentRows rows={completePay} onChange={setCompletePay} />
          </Field>
          <Checkbox label="Device handed over to the customer now (mark delivered)" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} />
        </div>
      </Modal>

      <CustomerPaymentModal open={modal === 'collect'} onClose={() => setModal(null)} customer={r.customerDetails} saleId={r.sale?._id} />
      <ConfirmDialog
        open={modal === 'cancel'}
        onClose={() => setModal(null)}
        title={`Cancel job ${r.jobNo}?`}
        message={r.advancePaid > 0 ? `The advance of ${formatMoney(r.advancePaid)} will be refunded. Reserved spare parts are released.` : 'Reserved spare parts are released. No stock was deducted.'}
        confirmLabel="Cancel job"
        requireReason
        loading={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
      >
        {r.advancePaid > 0 && (
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

function Item({ k, v }: { k: string; v?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{k}</dt>
      <dd className="whitespace-pre-line text-slate-800">{v || '—'}</dd>
    </div>
  );
}
