'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Textarea } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { customerOption, fetchCustomers } from '@/features/masters/options';
import { useInvalidate, useSettings } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { add, round, sub } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { cn, formatDate, formatMoney, openPrint, toDateInput } from '@/lib/utils';
import { customerService, customerPaymentService } from '@/services';
import type { Customer, CustomerPayment } from '@/types';
import { PaymentRows, emptyPayRow, payRowsToApi, payRowsTotal, type PayRow } from './PaymentRows';

/**
 * "Pay Customer Credit": pick customer -> outstanding invoices -> amount -> allocation
 * (oldest first or manual per invoice) -> receipt.
 */
export function CustomerPaymentModal({
  open,
  onClose,
  customer: initialCustomer,
  saleId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  customer?: Customer | null;
  saleId?: string;
  onDone?: (p: CustomerPayment) => void;
}) {
  const invalidate = useInvalidate();
  const { data: settings } = useSettings();
  const [customer, setCustomer] = useState<Option<Customer> | null>(null);
  const [rows, setRows] = useState<PayRow[]>([emptyPayRow()]);
  const [mode, setMode] = useState<'OLDEST_FIRST' | 'MANUAL'>('OLDEST_FIRST');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [date, setDate] = useState(toDateInput());
  const [notes, setNotes] = useState('');
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (!open) return;
    setCustomer(initialCustomer ? customerOption(initialCustomer) : null);
    setRows([emptyPayRow(settings?.billing?.defaultPaymentMethod)]);
    setMode(saleId ? 'MANUAL' : 'OLDEST_FIRST');
    setAlloc({});
    setDate(toDateInput());
    setNotes('');
    requestId.current = newRequestId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCustomer?._id, saleId, settings?.billing?.defaultPaymentMethod]);

  const cid = customer?.value;
  const { data: invoices, isLoading } = useQuery({ queryKey: [...qk.customers, cid, 'open-invoices'], queryFn: () => customerService.openInvoices(cid!), enabled: open && !!cid });
  const totalDue = add(...(invoices ?? []).map((i) => i.balanceDue));
  const amount = payRowsTotal(rows);

  useEffect(() => {
    if (saleId && invoices) {
      const inv = invoices.find((i) => i._id === saleId);
      if (inv) {
        setAlloc({ [saleId]: String(inv.balanceDue) });
        setRows((r) => (r.length === 1 && !r[0].amount ? [{ ...r[0], amount: String(inv.balanceDue) }] : r));
      }
    }
  }, [saleId, invoices]);

  // Preview of oldest-first allocation
  const preview: Record<string, number> = {};
  if (mode === 'OLDEST_FIRST') {
    let left = amount;
    for (const inv of invoices ?? []) {
      const take = Math.min(left, inv.balanceDue);
      if (take > 0) preview[inv._id] = round(take);
      left = sub(left, take);
    }
  }
  const manualTotal = add(...Object.values(alloc).map((v) => Number(v) || 0));

  const save = useMutation({
    mutationFn: () =>
      customerPaymentService.create({
        clientRequestId: requestId.current,
        customerId: cid,
        date: date === toDateInput() ? undefined : date,
        methods: payRowsToApi(rows),
        allocationMode: mode,
        allocations: mode === 'MANUAL' ? Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([saleId, v]) => ({ saleId, amount: Number(v) })) : undefined,
        notes: notes || undefined,
      }),
    onSuccess: async ({ data, meta }) => {
      toast.success(meta?.duplicate ? `Already recorded as ${data.receiptNo}` : `Receipt ${data.receiptNo} saved`, {
        action: { label: 'Print', onClick: () => openPrint(`/print/receipt/${data._id}?print=1`) },
      });
      await invalidate(...financialKeys);
      onDone?.(data);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const error =
    !cid ? 'Select a customer' : amount <= 0 ? 'Enter the amount received' : amount > totalDue ? `Amount exceeds total outstanding (${formatMoney(totalDue)})` : mode === 'MANUAL' && round(manualTotal) !== round(amount) ? `Allocated ${formatMoney(manualTotal)} must equal ${formatMoney(amount)}` : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Receive customer payment"
      description="Payments are allocated to outstanding invoices and posted to the customer ledger."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!!error}>
            Save payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Customer" required>
            <SearchSelect value={customer} onChange={(o) => setCustomer(o)} queryKey={[...qk.customers, 'with-balance']} fetchOptions={fetchCustomers} disabled={!!initialCustomer} clearable={!initialCustomer} />
          </Field>
          <Field label="Payment date">
            <Input type="date" value={date} max={toDateInput()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {cid && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">
                Outstanding invoices <span className="text-slate-500">· total {formatMoney(totalDue)}</span>
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
            ) : !invoices?.length ? (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">No outstanding invoices for this customer.</div>
            ) : (
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th>Due</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Balance</th>
                      <th className="w-32 text-right">Allocate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const overdue = inv.dueDate && new Date(inv.dueDate) < new Date();
                      return (
                        <tr key={inv._id}>
                          <td className="font-medium">{inv.invoiceNo}</td>
                          <td>{formatDate(inv.date)}</td>
                          <td className={overdue ? 'font-medium text-red-600' : ''}>{formatDate(inv.dueDate)}</td>
                          <td className="text-right">{formatMoney(inv.grandTotal)}</td>
                          <td className="text-right font-medium">{formatMoney(inv.balanceDue)}</td>
                          <td className="text-right">
                            {mode === 'MANUAL' ? (
                              <MoneyInput className="h-8 py-1" value={alloc[inv._id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [inv._id]: e.target.value })} max={inv.balanceDue} />
                            ) : (
                              <span className="tabular-nums">{preview[inv._id] ? formatMoney(preview[inv._id]) : '—'}</span>
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
          <Field label="Amount received" required>
            <PaymentRows rows={rows} onChange={setRows} />
            {cid && totalDue > 0 && (
              <button type="button" className="mt-1 self-start text-xs font-medium text-brand-700" onClick={() => setRows([{ ...rows[0], amount: String(totalDue) }])}>
                Pay full outstanding ({formatMoney(totalDue)})
              </button>
            )}
          </Field>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </Field>
        </div>
        {error && cid && amount > 0 && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
