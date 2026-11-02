'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Badge, Spinner } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { VendorFormModal } from '@/features/masters/QuickCreate';
import { fetchVendors, vendorOption } from '@/features/masters/options';
import { useInvalidate, usePaymentMethods, useSettings } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { add, round, sub } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { cn, formatDate, formatMoney, openPrint, toDateInput } from '@/lib/utils';
import { vendorPaymentService, vendorService } from '@/services';
import type { Vendor } from '@/types';

/**
 * "Pay Vendor Credit": vendor -> open purchases -> amount -> allocation (oldest first / manual)
 * -> optional excess as advance -> voucher. Also supports applying an existing advance.
 */
export function VendorPaymentModal({ open, onClose, vendor: initialVendor, purchaseId, mode: modeProp = 'PAY' }: { open: boolean; onClose: () => void; vendor?: Vendor | null; purchaseId?: string; mode?: 'PAY' | 'APPLY_ADVANCE' }) {
  const invalidate = useInvalidate();
  const { data: settings } = useSettings();
  const { data: methods = [] } = usePaymentMethods();
  const [vendor, setVendor] = useState<Option<Vendor> | null>(null);
  const [addVendor, setAddVendor] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(toDateInput());
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'OLDEST_FIRST' | 'MANUAL'>('OLDEST_FIRST');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [excessAdvance, setExcessAdvance] = useState(false);
  const requestId = useRef(newRequestId());
  const applyAdvance = modeProp === 'APPLY_ADVANCE';

  useEffect(() => {
    if (!open) return;
    setVendor(initialVendor ? vendorOption(initialVendor) : null);
    setAmount('');
    setMethod(settings?.billing?.defaultPaymentMethod ?? 'Cash');
    setReference('');
    setDate(toDateInput());
    setNotes('');
    setMode(purchaseId ? 'MANUAL' : settings?.vendorPayments?.defaultAllocation ?? 'OLDEST_FIRST');
    setAlloc({});
    setExcessAdvance(false);
    requestId.current = newRequestId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialVendor?._id, purchaseId, settings?.billing?.defaultPaymentMethod]);

  const vid = vendor?.value;
  const { data: purchases, isLoading } = useQuery({ queryKey: [...qk.vendors, vid, 'open-purchases'], queryFn: () => vendorService.openPurchases(vid!), enabled: open && !!vid });
  const { data: vendorDetail } = useQuery({ queryKey: qk.vendor(vid ?? ''), queryFn: () => vendorService.get(vid!), enabled: open && !!vid });
  const totalDue = add(...(purchases ?? []).map((p) => p.balanceDue));
  const amt = round(Number(amount) || 0);

  useEffect(() => {
    if (purchaseId && purchases) {
      const p = purchases.find((x) => x._id === purchaseId);
      if (p) {
        setAlloc({ [purchaseId]: String(p.balanceDue) });
        setAmount(String(p.balanceDue));
      }
    }
  }, [purchaseId, purchases]);

  const preview: Record<string, number> = {};
  if (mode === 'OLDEST_FIRST') {
    let left = amt;
    for (const p of purchases ?? []) {
      const take = Math.min(left, p.balanceDue);
      if (take > 0) preview[p._id] = round(take);
      left = sub(left, take);
    }
  }
  const allocated = mode === 'MANUAL' ? add(...Object.values(alloc).map((v) => Number(v) || 0)) : add(...Object.values(preview));
  const excess = sub(amt, allocated);

  const save = useMutation({
    mutationFn: async () => {
      const allocations = mode === 'MANUAL' ? Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([purchaseId, v]) => ({ purchaseId, amount: Number(v) })) : undefined;
      if (applyAdvance) {
        const data = await vendorPaymentService.applyAdvance({ clientRequestId: requestId.current, vendorId: vid, amount: amt, allocationMode: mode, allocations, notes: notes || undefined });
        return { data, meta: undefined };
      }
      return vendorPaymentService.create({
        clientRequestId: requestId.current,
        vendorId: vid,
        date: date === toDateInput() ? undefined : date,
        amount: amt,
        method,
        reference: reference || undefined,
        allocationMode: mode,
        allocations,
        recordExcessAsAdvance: excessAdvance,
        notes: notes || undefined,
      });
    },
    onSuccess: async ({ data, meta }) => {
      toast.success(meta?.duplicate ? `Already recorded as ${data.paymentNo}` : `Payment ${data.paymentNo} saved`, {
        action: { label: 'Print', onClick: () => openPrint(`/print/vendor-payment/${data._id}?print=1`) },
      });
      await invalidate(...financialKeys);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const advanceAvailable = vendorDetail?.advanceBalance ?? 0;
  const error = !vid
    ? 'Select a vendor'
    : amt <= 0
      ? 'Enter the amount'
      : applyAdvance && amt > advanceAvailable
        ? `Only ${formatMoney(advanceAvailable)} advance is available`
        : mode === 'MANUAL' && allocated > amt
          ? 'Allocations exceed the amount'
          : excess > 0 && (applyAdvance || !excessAdvance)
            ? `${formatMoney(excess)} is not allocated${applyAdvance ? '' : ' — reduce the amount or record it as an advance'}`
            : null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={applyAdvance ? 'Apply vendor advance to purchases' : 'Pay vendor credit'}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!!error}>
              {applyAdvance ? 'Apply advance' : 'Save payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <Field label="Vendor" required>
              <SearchSelect
                value={vendor}
                onChange={setVendor}
                queryKey={qk.vendors}
                fetchOptions={fetchVendors}
                disabled={!!initialVendor}
                clearable={!initialVendor}
                onAddNew={initialVendor ? undefined : (t) => setAddVendor(t)}
                addLabel="Add vendor"
              />
              {vendorDetail && vendorDetail.advanceBalance > 0 && (
                <div className="mt-1">
                  <Badge tone="teal">Advance with vendor {formatMoney(vendorDetail.advanceBalance)}</Badge>
                </div>
              )}
            </Field>
            {!applyAdvance && (
              <Field label="Payment date">
                <Input type="date" value={date} max={toDateInput()} onChange={(e) => setDate(e.target.value)} />
              </Field>
            )}
          </div>
          {vid && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">
                  Unpaid purchases <span className="text-slate-500">· total {formatMoney(totalDue)}</span>
                </div>
                <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs">
                  {(['OLDEST_FIRST', 'MANUAL'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMode(m)} className={cn('rounded-md px-2 py-1 font-medium', mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>
                      {m === 'OLDEST_FIRST' ? 'Oldest first' : 'Manual allocation'}
                    </button>
                  ))}
                </div>
              </div>
              {isLoading ? (
                <Spinner />
              ) : !purchases?.length ? (
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">No unpaid purchases for this vendor.</div>
              ) : (
                <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Purchase</th>
                        <th>Vendor inv.</th>
                        <th>Due</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Balance</th>
                        <th className="w-32 text-right">Allocate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchases.map((p) => {
                        const overdue = p.dueDate && new Date(p.dueDate) < new Date();
                        return (
                          <tr key={p._id}>
                            <td className="font-medium">{p.purchaseNo}</td>
                            <td>{p.vendorInvoiceNo ?? '—'}</td>
                            <td className={overdue ? 'font-medium text-red-600' : ''}>{formatDate(p.dueDate)}</td>
                            <td className="text-right">{formatMoney(p.grandTotal)}</td>
                            <td className="text-right font-medium">{formatMoney(p.balanceDue)}</td>
                            <td className="text-right">
                              {mode === 'MANUAL' ? (
                                <MoneyInput className="h-8 py-1" value={alloc[p._id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [p._id]: e.target.value })} />
                              ) : (
                                <span className="tabular-nums">{preview[p._id] ? formatMoney(preview[p._id]) : '—'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={applyAdvance ? 'Advance to apply' : 'Amount paid'} required>
              <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
              {totalDue > 0 && (
                <button type="button" className="mt-1 self-start text-xs font-medium text-brand-700" onClick={() => setAmount(String(applyAdvance ? Math.min(totalDue, advanceAvailable) : totalDue))}>
                  {applyAdvance ? 'Apply maximum' : `Pay full outstanding (${formatMoney(totalDue)})`}
                </button>
              )}
            </Field>
            {!applyAdvance && (
              <Field label="Payment method" required>
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {methods.map((m) => (
                    <option key={m._id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!applyAdvance && (
              <Field label="Transaction / reference no.">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            )}
            <Field label="Notes" className={applyAdvance ? '' : ''}>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </Field>
          </div>
          {!applyAdvance && excess > 0 && amt > 0 && (
            <Checkbox label={`Record the excess ${formatMoney(excess)} as a vendor advance`} checked={excessAdvance} onChange={(e) => setExcessAdvance(e.target.checked)} />
          )}
          {error && vid && amt > 0 && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Modal>
      <VendorFormModal open={addVendor !== null} initialName={addVendor ?? ''} onClose={() => setAddVendor(null)} onSaved={(v) => setVendor(vendorOption(v))} />
    </>
  );
}
