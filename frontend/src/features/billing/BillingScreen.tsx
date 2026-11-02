'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, Eye, FilePlus2, Plus, Printer, Save, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Badge, EmptyState } from '@/components/ui/Misc';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { SearchSelect, type SearchSelectHandle } from '@/components/ui/SearchSelect';
import { CustomerFormModal } from '@/features/masters/QuickCreate';
import { customerOption, fetchCustomers } from '@/features/masters/options';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidate, usePaymentMethods, useSettings } from '@/hooks/useCommon';
import { ApiError, downloadFile, errorMessage, newRequestId } from '@/lib/api';
import { calculateBill, paymentSummary } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { cn, formatMoney, formatNumber, openPrint, printInBackground, toDateInput } from '@/lib/utils';
import { customerService, saleService } from '@/services';
import type { Sale } from '@/types';
import { ItemEntry, type ItemEntryHandle } from './ItemEntry';
import type { BillFormValues, BillItem } from './types';

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function BillingScreen() {
  const { can, user } = useAuth();
  const { data: settings } = useSettings();
  const { data: methods = [] } = usePaymentMethods();
  const invalidate = useInvalidate();
  const itemEntry = useRef<ItemEntryHandle>(null);
  const customerRef = useRef<SearchSelectHandle>(null);
  const firstPaymentRef = useRef<HTMLInputElement | null>(null);
  const requestId = useRef(newRequestId());
  const printAfterSave = useRef(false);
  const [addCustomer, setAddCustomer] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  const [dateEdited, setDateEdited] = useState(false);

  const defaultMethod = settings?.billing?.defaultPaymentMethod ?? 'Cash';
  const blank = useCallback(
    (): BillFormValues => ({
      customer: null,
      date: nowLocal(),
      items: [],
      billDiscount: '',
      payments: [{ method: defaultMethod, amount: '', reference: '' }],
      dueDate: '',
      notes: '',
      allowStockOverride: false,
    }),
    [defaultMethod],
  );

  const form = useForm<BillFormValues>({ defaultValues: blank() });
  const items = useFieldArray({ control: form.control, name: 'items', keyName: 'fieldKey' });
  const payments = useFieldArray({ control: form.control, name: 'payments' });

  // Default to the walk-in customer.
  const walkInId = settings?.billing?.walkInEnabled ? settings.billing.walkInCustomer : undefined;
  const { data: walkIn } = useQuery({ queryKey: [...qk.customers, 'walk-in', walkInId], queryFn: () => customerService.get(walkInId!), enabled: Boolean(walkInId), staleTime: Infinity });
  const customer = form.watch('customer');
  useEffect(() => {
    if (walkIn && !form.getValues('customer')) form.setValue('customer', customerOption(walkIn));
  }, [walkIn, form]);
  useEffect(() => {
    const current = form.getValues('payments');
    if (current.length === 1 && !current[0].amount && current[0].method !== defaultMethod) form.setValue('payments.0.method', defaultMethod);
  }, [defaultMethod, form]);

  const watchedItems = form.watch('items');
  const billDiscount = form.watch('billDiscount');
  const watchedPayments = form.watch('payments');
  const taxEnabled = Boolean(settings?.tax?.enabled);
  const defaultTax = settings?.tax?.defaultRate ?? 0;

  // Recomputed every render: watch() returns the same (mutated) array when a cart cell is edited,
  // so memoising on it would leave the bill totals stale.
  const totals = calculateBill(
    watchedItems.map((i) => ({ qty: Number(i.qty) || 0, unitPrice: Number(i.unitPrice) || 0, discount: Number(i.discount) || 0, taxRate: i.taxRate ?? defaultTax })),
    Number(billDiscount) || 0,
    taxEnabled,
  );
  // Keep a single "full payment" row in step with the grand total when cart lines are edited.
  const lastGrandTotal = useRef(totals.grandTotal);
  useEffect(() => {
    const prev = lastGrandTotal.current;
    lastGrandTotal.current = totals.grandTotal;
    if (prev === totals.grandTotal) return;
    const current = form.getValues('payments');
    if (current.length === 1 && Number(current[0].amount) === prev && prev > 0) {
      form.setValue('payments.0.amount', totals.grandTotal > 0 ? String(totals.grandTotal) : '');
    }
  }, [totals.grandTotal, form]);
  const cashNames = useMemo(() => new Set(methods.filter((m) => m.kind === 'CASH').map((m) => m.name)), [methods]);
  const pay = paymentSummary(
    totals.grandTotal,
    watchedPayments.map((p) => ({ amount: Number(p.amount) || 0, isCash: cashNames.has(p.method) })),
  );
  const isWalkIn = Boolean(customer?.data?.isWalkIn);
  const maxDiscPct = settings?.billing?.maxCashierDiscountPercent ?? 0;
  const unlimitedDiscount = can('sales.unlimitedDiscount');
  const canOverride = Boolean(settings?.billing?.allowStockOverride && can('sales.stockOverride'));
  const allowOverride = form.watch('allowStockOverride');

  const stockIssues = watchedItems
    .map((it, idx) => {
      if (!it.trackInventory || it.stock === undefined) return null;
      const used = watchedItems.filter((x) => x.productId === it.productId).reduce((a, x) => a + (Number(x.qty) || 0), 0);
      return used > it.stock ? idx : null;
    })
    .filter((x): x is number => x !== null);

  const addItem = (item: BillItem) => {
    const list = form.getValues('items');
    const same = list.findIndex((x) => x.productId && x.productId === item.productId && !item.trackSerial && x.itemType === 'PRODUCT' && item.itemType === 'PRODUCT' && x.unitPrice === item.unitPrice && !x.discount && !item.discount);
    if (same >= 0) {
      form.setValue(`items.${same}.qty`, (Number(list[same].qty) || 0) + item.qty, { shouldDirty: true });
    } else {
      items.append(item);
    }
  };

  const reset = () => {
    form.reset(blank());
    if (walkIn) form.setValue('customer', customerOption(walkIn));
    requestId.current = newRequestId();
    setDateEdited(false);
    setTimeout(() => itemEntry.current?.focusSearch(), 50);
  };

  const save = useMutation({
    mutationFn: (values: BillFormValues) =>
      saleService.create({
        clientRequestId: requestId.current,
        date: dateEdited && values.date ? new Date(values.date).toISOString() : undefined,
        customerId: values.customer?.value,
        items: values.items.map((i) => ({
          itemType: i.itemType,
          productId: i.productId,
          name: i.name,
          description: i.description,
          qty: Number(i.qty),
          unitPrice: Number(i.unitPrice),
          discount: Number(i.discount) || 0,
          serials: i.serials?.length ? i.serials : undefined,
          device: i.device && Object.values(i.device).some(Boolean) ? { deviceCategoryId: i.device.deviceCategoryId, brandId: i.device.brandId, deviceModelId: i.device.deviceModelId, imei: i.device.imei } : undefined,
          complaint: i.complaint,
          sparePart: i.sparePart ? { productId: i.sparePart.productId, qty: i.sparePart.qty, dealerId: i.sparePart.dealerId } : undefined,
          warranty: i.warranty,
        })),
        billDiscount: Number(values.billDiscount) || 0,
        payments: values.payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference || undefined })),
        dueDate: values.dueDate || undefined,
        notes: values.notes || undefined,
        allowStockOverride: values.allowStockOverride || undefined,
      }),
    onSuccess: async ({ data, meta }) => {
      if (meta?.duplicate) toast.info(`This bill was already saved as ${data.invoiceNo}`);
      else toast.success(`Invoice ${data.invoiceNo} saved`);
      setDone(data);
      if (printAfterSave.current) {
        printInBackground(`/print/invoice/${data._id}?print=1`);
        printAfterSave.current = false;
      }
      reset();
      await invalidate(...financialKeys);
    },
    onError: (err) => {
      printAfterSave.current = false;
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK') toast.error(err.message, { duration: 6000 });
      else toast.error(errorMessage(err));
    },
  });

  const submit = (print: boolean) => {
    const v = form.getValues();
    if (!v.items.length) return toast.error('Add at least one item');
    if (!v.customer) return toast.error('Select a customer');
    if (pay.invalidOverpay) return toast.error('Only cash can be more than the amount due (to give change)');
    if (pay.balanceDue > 0 && isWalkIn) {
      toast.error('Balance due needs a registered customer - select or add the customer, or collect the full amount');
      customerRef.current?.focus();
      return;
    }
    if (stockIssues.length && !(canOverride && v.allowStockOverride)) return toast.error('Some items exceed available stock');
    if (!unlimitedDiscount) {
      const bad = v.items.findIndex((i) => (Number(i.discount) || 0) > ((Number(i.unitPrice) * Number(i.qty)) * maxDiscPct) / 100);
      if (bad >= 0) return toast.error(`Discount on line ${bad + 1} exceeds your ${maxDiscPct}% limit`);
    }
    printAfterSave.current = print;
    save.mutate(v);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        itemEntry.current?.focusSearch();
      } else if (e.key === 'F4') {
        e.preventDefault();
        customerRef.current?.focus();
      } else if (e.key === 'F8') {
        e.preventDefault();
        firstPaymentRef.current?.focus();
      } else if (e.key === 'F9') {
        e.preventDefault();
        submit(false);
      } else if (e.key === 'F10') {
        e.preventDefault();
        submit(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    setTimeout(() => itemEntry.current?.focusSearch(), 100);
  }, []);

  const fillFull = (method: string) => {
    form.setValue('payments', [{ method, amount: String(totals.grandTotal), reference: '' }]);
  };

  return (
    <div>
      <PageHeader
        title="New Sale"
        crumbs={[{ label: 'Billing' }]}
        subtitle={
          <span className="text-xs">
            Shortcuts: <kbd className="rounded border bg-white px-1">F2</kbd> item · <kbd className="rounded border bg-white px-1">F4</kbd> customer · <kbd className="rounded border bg-white px-1">F8</kbd> payment ·{' '}
            <kbd className="rounded border bg-white px-1">F9</kbd> save · <kbd className="rounded border bg-white px-1">F10</kbd> save &amp; print
          </span>
        }
        actions={
          <>
            <Link href="/sales">
              <Button variant="outline" size="sm">
                Invoices
              </Button>
            </Link>
            <Button variant="outline" size="sm" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => (watchedItems.length ? setConfirmClear(true) : reset())}>
              New bill
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_auto]">
            <Field label="Customer (F4)">
              <SearchSelect
                ref={customerRef}
                value={customer}
                onChange={(o) => form.setValue('customer', o)}
                queryKey={qk.customers}
                fetchOptions={fetchCustomers}
                placeholder="Search name or mobile…"
                onAddNew={(t) => setAddCustomer(t)}
                addLabel="Add customer"
                clearable={false}
              />
              {customer?.data && !isWalkIn && (
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{customer.data.mobile}</span>
                  {customer.data.balance > 0 && <Badge tone="amber">Previous due {formatMoney(customer.data.balance)}</Badge>}
                </div>
              )}
              {isWalkIn && <div className="mt-1 text-xs text-slate-500">Walk-in sale — full payment required.</div>}
            </Field>
            <Field label="Invoice date & time">
              <Input
                type="datetime-local"
                value={form.watch('date')}
                onChange={(e) => {
                  form.setValue('date', e.target.value);
                  setDateEdited(true);
                }}
                disabled={user?.role !== 'ADMIN'}
                title={user?.role !== 'ADMIN' ? 'Only an admin can back-date invoices' : undefined}
              />
            </Field>
          </div>

          <ItemEntry ref={itemEntry} onAdd={addItem} canManual={can('sales.manualItem')} existingSerials={watchedItems.flatMap((i) => i.serials ?? [])} />

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Model / Description</th>
                    <th className="w-24 text-right">Qty</th>
                    <th className="w-32 text-right">Unit Price</th>
                    <th className="w-28 text-right">Discount</th>
                    <th className="text-right">Total</th>
                    <th className="w-12 text-center">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.fields.map((f, i) => {
                    const it = watchedItems[i] ?? f;
                    const line = totals.lines[i];
                    const over = stockIssues.includes(i);
                    return (
                      <tr key={f.fieldKey} className={cn(over && 'bg-red-50/60')}>
                        <td className="min-w-[12rem]">
                          <div className="font-medium text-slate-800">{it.name}</div>
                          <div className="flex flex-wrap gap-1 text-xs text-slate-500">
                            {it.itemType === 'SERVICE' && <Badge tone="teal">Service</Badge>}
                            {it.serials?.length ? <span className="font-mono">IMEI: {it.serials.join(', ')}</span> : null}
                            {it.sparePart && (
                              <span>
                                Spare: {it.sparePart.name} × {it.sparePart.qty}
                                {it.sparePart.dealerName ? ` (${it.sparePart.dealerName})` : ''}
                              </span>
                            )}
                            {it.warranty && it.warranty.status !== 'NONE' && <Badge tone="green">Warranty{it.warranty.expiryDate ? ` till ${it.warranty.expiryDate}` : ''}</Badge>}
                            {it.trackInventory && it.stock !== undefined && (
                              <span className={over ? 'font-medium text-red-600' : ''}>
                                Stock {formatNumber(it.stock)}
                                {over ? ' — exceeds stock' : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-slate-600">{it.category ?? '—'}</td>
                        <td className="max-w-[14rem] text-slate-600">
                          <div className="truncate">{[it.device?.brandName, it.device?.deviceModelName].filter(Boolean).join(' ') || it.description || '—'}</div>
                          {it.complaint && <div className="truncate text-xs text-slate-500">{it.complaint}</div>}
                        </td>
                        <td>
                          <Input type="number" min={0} step="any" className="text-right" {...form.register(`items.${i}.qty`)} disabled={!!it.trackSerial} aria-label="Quantity" onFocus={(e) => e.currentTarget.select()} />
                        </td>
                        <td>
                          <MoneyInput {...form.register(`items.${i}.unitPrice`)} aria-label="Unit price" />
                        </td>
                        <td>
                          <MoneyInput {...form.register(`items.${i}.discount`)} aria-label="Discount" />
                        </td>
                        <td className="text-right font-medium tabular-nums">{formatMoney(line?.lineTotal ?? 0)}</td>
                        <td className="text-center">
                          <IconButton label={`Remove ${it.name}`} onClick={() => items.remove(i)} className="text-red-500 hover:bg-red-50 hover:text-red-700">
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!items.fields.length && <EmptyState title="No items yet" message="Search or scan a product, or switch to Repair / Service to bill a job." />}
            </div>
          </div>
          {stockIssues.length > 0 && canOverride && <Checkbox label="Allow selling beyond available stock (admin override)" {...form.register('allowStockOverride')} />}
        </div>

        {/* Totals + payment */}
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <div className="card p-4">
            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
              <Row label="Item discounts" value={`- ${formatMoney(totals.itemDiscount)}`} muted />
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-600">Bill discount</dt>
                <dd className="w-32">
                  <MoneyInput {...form.register('billDiscount')} placeholder="0" className="h-8 py-1" aria-label="Bill discount" />
                </dd>
              </div>
              {taxEnabled && (
                <>
                  <Row label="Taxable amount" value={formatMoney(totals.taxable)} muted />
                  <Row label={settings?.tax?.name ?? 'Tax'} value={formatMoney(totals.tax)} />
                </>
              )}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-3">
              <span className="text-sm font-medium text-slate-600">Grand total</span>
              <span className="text-3xl font-bold text-slate-900 tabular-nums">{formatMoney(totals.grandTotal)}</span>
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Payment (F8)</h2>
              <div className="flex gap-1">
                {methods.slice(0, 3).map((m) => (
                  <button key={m._id} type="button" onClick={() => fillFull(m.name)} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700" disabled={!totals.grandTotal}>
                    Full {m.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {payments.fields.map((f, i) => {
                const { ref: amountRef, ...amountReg } = form.register(`payments.${i}.amount`);
                return (
                  <div key={f.id} className="grid grid-cols-[1fr_7rem_auto] gap-2">
                    <Select {...form.register(`payments.${i}.method`)} aria-label="Payment method">
                      {methods.map((m) => (
                        <option key={m._id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                    <MoneyInput
                      {...amountReg}
                      ref={(el) => {
                        amountRef(el);
                        if (i === 0) firstPaymentRef.current = el;
                      }}
                      placeholder="0"
                      aria-label="Amount"
                    />
                    {payments.fields.length > 1 ? (
                      <IconButton label="Remove payment" onClick={() => payments.remove(i)}>
                        <X className="h-4 w-4" />
                      </IconButton>
                    ) : (
                      <span className="w-8" />
                    )}
                    {!cashNames.has(watchedPayments[i]?.method) && Number(watchedPayments[i]?.amount) > 0 && (
                      <Input className="col-span-2 h-8 py-1 text-xs" placeholder="Transaction / reference no." {...form.register(`payments.${i}.reference`)} />
                    )}
                  </div>
                );
              })}
              <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => payments.append({ method: methods.find((m) => !watchedPayments.some((p) => p.method === m.name))?.name ?? defaultMethod, amount: String(pay.balanceDue > 0 ? pay.balanceDue : ''), reference: '' })}>
                Split payment
              </Button>
            </div>
            <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
              <Row label="Amount paid" value={formatMoney(pay.applied)} />
              <Row label="Balance due" value={formatMoney(pay.balanceDue)} strong={pay.balanceDue > 0} tone={pay.balanceDue > 0 ? 'text-amber-700' : undefined} />
              {pay.changeDue > 0 && <Row label="Change to return" value={formatMoney(pay.changeDue)} strong tone="text-emerald-700" />}
              {pay.invalidOverpay && <p className="text-xs text-red-600">Only cash can exceed the amount due.</p>}
            </dl>
            {pay.balanceDue > 0 && !isWalkIn && totals.grandTotal > 0 && (
              <Field label="Credit due date" className="mt-3" hint={`Balance ${formatMoney(pay.balanceDue)} will be added to the customer's credit`}>
                <Input type="date" {...form.register('dueDate')} min={toDateInput()} />
              </Field>
            )}
            <Field label="Notes" className="mt-3">
              <Textarea {...form.register('notes')} rows={2} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="outline" icon={<Save className="h-4 w-4" />} onClick={() => submit(false)} loading={save.isPending && !printAfterSave.current}>
              Save (F9)
            </Button>
            <Button size="lg" icon={<Printer className="h-4 w-4" />} onClick={() => submit(true)} loading={save.isPending}>
              Save &amp; Print
            </Button>
            <Button variant="ghost" className="col-span-2 text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmClear(true)} disabled={!watchedItems.length}>
              Cancel draft
            </Button>
          </div>
        </aside>
      </div>

      <CustomerFormModal open={addCustomer !== null} initialName={addCustomer ?? ''} onClose={() => setAddCustomer(null)} onSaved={(c) => form.setValue('customer', customerOption(c))} />
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Discard this bill?"
        message="All items and payments entered on this draft will be cleared. Nothing has been saved yet."
        confirmLabel="Discard draft"
        onConfirm={() => {
          setConfirmClear(false);
          reset();
        }}
      />
      <SaleDoneModal sale={done} onClose={() => setDone(null)} />
    </div>
  );
}

function Row({ label, value, muted, strong, tone }: { label: string; value: string; muted?: boolean; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={cn(muted ? 'text-slate-500' : 'text-slate-600')}>{label}</dt>
      <dd className={cn('tabular-nums', strong && 'font-semibold', tone)}>{value}</dd>
    </div>
  );
}

function SaleDoneModal({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const [downloading, setDownloading] = useState(false);
  if (!sale) return null;
  return (
    <Modal
      open={!!sale}
      onClose={onClose}
      size="sm"
      title={
        <span className="flex items-center gap-2 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" /> Bill saved
        </span>
      }
      footer={
        <Button onClick={onClose} data-autofocus>
          New bill
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="flex justify-between">
            <span className="text-slate-500">Invoice</span>
            <span className="font-semibold">{sale.invoiceNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total</span>
            <span className="font-semibold">{formatMoney(sale.grandTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Paid</span>
            <span>{formatMoney(sale.amountPaid)}</span>
          </div>
          {sale.balanceDue > 0 && (
            <div className="flex justify-between text-amber-700">
              <span>Balance (customer credit)</span>
              <span className="font-semibold">{formatMoney(sale.balanceDue)}</span>
            </div>
          )}
          {sale.changeDue > 0 && (
            <div className="flex justify-between text-lg font-semibold text-emerald-700">
              <span>Change to return</span>
              <span>{formatMoney(sale.changeDue)}</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => openPrint(`/print/invoice/${sale._id}?print=1`)}>
            Print
          </Button>
          <Button variant="outline" icon={<Eye className="h-4 w-4" />} onClick={() => openPrint(`/print/invoice/${sale._id}`)}>
            Preview
          </Button>
          <Button
            variant="outline"
            loading={downloading}
            icon={<Download className="h-4 w-4" />}
            onClick={async () => {
              setDownloading(true);
              try {
                await downloadFile(`/sales/${sale._id}/pdf`, `${sale.invoiceNo}.pdf`);
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setDownloading(false);
              }
            }}
          >
            PDF
          </Button>
        </div>
        <Link href={`/sales/${sale._id}`} className="block text-center text-sm font-medium text-brand-700 hover:underline">
          Open invoice details
        </Link>
      </div>
    </Modal>
  );
}

