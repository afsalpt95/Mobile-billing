'use client';

import { useMutation } from '@tanstack/react-query';
import { PackageCheck, Plus, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Card, EmptyState } from '@/components/ui/Misc';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { ProductFormModal, VendorFormModal } from '@/features/masters/QuickCreate';
import { fetchProducts, fetchVendors, productOption, vendorOption } from '@/features/masters/options';
import { useInvalidate, usePaymentMethods, useSettings } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { add, allocate, mul, percentOf, sub } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatMoney, toDateInput } from '@/lib/utils';
import { purchaseService } from '@/services';
import type { Product, Purchase, Vendor } from '@/types';

interface Line {
  product: Option<Product> | null;
  qty: string;
  freeQty: string;
  unitCost: string;
  discount: string;
  taxRate: string;
  serials: string;
}

interface FormValues {
  vendor: Option<Vendor> | null;
  vendorInvoiceNo: string;
  date: string;
  dueDate: string;
  paymentTerms: string;
  items: Line[];
  shippingCharges: string;
  otherCharges: string;
  paidAmount: string;
  paidMethod: string;
  paidReference: string;
  notes: string;
  attachmentRef: string;
}

const STOCK_TYPES = 'PHONE,SPARE_PART,ACCESSORY,CONSUMABLE,OTHER';
const emptyLine = (): Line => ({ product: null, qty: '1', freeQty: '', unitCost: '', discount: '', taxRate: '', serials: '' });
const splitSerials = (s: string) => s.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

export function PurchaseForm({ initial, initialVendor }: { initial?: Purchase & { productsById?: Record<string, Product> }; initialVendor?: Vendor | null }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const { data: settings } = useSettings();
  const { data: methods = [] } = usePaymentMethods();
  const requestId = useRef(newRequestId());
  const [nested, setNested] = useState<{ kind: 'vendor' | 'product'; text: string; line?: number } | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      vendor: null,
      vendorInvoiceNo: '',
      date: toDateInput(),
      dueDate: '',
      paymentTerms: '',
      items: [emptyLine()],
      shippingCharges: '',
      otherCharges: '',
      paidAmount: '',
      paidMethod: 'Cash',
      paidReference: '',
      notes: '',
      attachmentRef: '',
    },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });

  useEffect(() => {
    if (initial) {
      form.reset({
        vendor: { value: initial.vendor, label: initial.vendorName, data: initial.vendorDetails },
        vendorInvoiceNo: initial.vendorInvoiceNo ?? '',
        date: toDateInput(new Date(initial.date)),
        dueDate: initial.dueDate ? toDateInput(new Date(initial.dueDate)) : '',
        paymentTerms: initial.paymentTerms ?? '',
        items: initial.items.map((i) => ({
          product: initial.productsById?.[i.product] ? productOption(initial.productsById[i.product]) : { value: i.product, label: i.name },
          qty: String(i.qty),
          freeQty: i.freeQty ? String(i.freeQty) : '',
          unitCost: String(i.unitCost),
          discount: i.discount ? String(i.discount) : '',
          taxRate: i.taxRate ? String(i.taxRate) : '',
          serials: (i.serials ?? []).join('\n'),
        })),
        shippingCharges: initial.shippingCharges ? String(initial.shippingCharges) : '',
        otherCharges: initial.otherCharges ? String(initial.otherCharges) : '',
        paidAmount: initial.initialPayment?.amount ? String(initial.initialPayment.amount) : '',
        paidMethod: initial.initialPayment?.method ?? 'Cash',
        paidReference: initial.initialPayment?.reference ?? '',
        notes: initial.notes ?? '',
        attachmentRef: initial.attachmentRef ?? '',
      });
    } else if (initialVendor) {
      form.setValue('vendor', vendorOption(initialVendor));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?._id, initialVendor?._id, form]);

  useEffect(() => {
    if (!initial && settings?.billing?.defaultPaymentMethod) form.setValue('paidMethod', settings.billing.defaultPaymentMethod);
  }, [settings, initial, form]);

  // Due date from vendor payment terms
  const vendor = form.watch('vendor');
  const date = form.watch('date');
  useEffect(() => {
    const days = vendor?.data?.paymentTermsDays;
    if (days && date && !form.getValues('dueDate')) {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      form.setValue('dueDate', toDateInput(d));
    }
  }, [vendor, date, form]);

  const watched = form.watch('items');
  const shipping = Number(form.watch('shippingCharges')) || 0;
  const other = Number(form.watch('otherCharges')) || 0;
  const taxInCost = settings?.tax?.purchaseTaxInCost ?? true;
  const totals = useMemo(() => {
    const lines = watched.map((l) => {
      const gross = mul(Number(l.unitCost) || 0, Number(l.qty) || 0);
      const lineTotal = sub(gross, Number(l.discount) || 0);
      const tax = Number(l.taxRate) ? percentOf(lineTotal, Number(l.taxRate)) : 0;
      return { gross, lineTotal, tax, base: taxInCost ? add(lineTotal, tax) : lineTotal };
    });
    const charges = add(shipping, other);
    const shares = allocate(charges, lines.map((l) => l.base || l.gross || 1));
    const landed = lines.map((l, i) => {
      const units = (Number(watched[i].qty) || 0) + (Number(watched[i].freeQty) || 0);
      return units ? (l.base + shares[i]) / units : 0;
    });
    const subtotal = add(...lines.map((l) => l.gross));
    const discount = add(...watched.map((l) => Number(l.discount) || 0));
    const tax = add(...lines.map((l) => l.tax));
    return { lines, landed, subtotal, discount, tax, charges, grandTotal: add(sub(subtotal, discount), tax, charges) };
  }, [watched, shipping, other, taxInCost]);
  const paid = Number(form.watch('paidAmount')) || 0;

  const save = useMutation({
    mutationFn: (args: { values: FormValues; receive: boolean }) => {
      const v = args.values;
      const body = {
        clientRequestId: initial ? undefined : requestId.current,
        vendorId: v.vendor?.value,
        vendorInvoiceNo: v.vendorInvoiceNo || undefined,
        date: v.date ? `${v.date}T${new Date().toTimeString().slice(0, 8)}` : undefined,
        dueDate: v.dueDate || undefined,
        paymentTerms: v.paymentTerms || undefined,
        items: v.items.map((l) => ({
          productId: l.product?.value,
          qty: Number(l.qty),
          freeQty: Number(l.freeQty) || 0,
          unitCost: Number(l.unitCost) || 0,
          discount: Number(l.discount) || 0,
          taxRate: Number(l.taxRate) || 0,
          serials: l.product?.data?.trackSerial ? splitSerials(l.serials) : undefined,
        })),
        shippingCharges: Number(v.shippingCharges) || 0,
        otherCharges: Number(v.otherCharges) || 0,
        initialPayment: Number(v.paidAmount) > 0 ? { amount: Number(v.paidAmount), method: v.paidMethod, reference: v.paidReference || undefined } : undefined,
        notes: v.notes || undefined,
        attachmentRef: v.attachmentRef || undefined,
        receive: args.receive,
      };
      return initial ? purchaseService.update(initial._id, body).then((data) => ({ data, meta: undefined })) : purchaseService.create(body);
    },
    onSuccess: async ({ data, meta }, { receive }) => {
      toast.success(meta?.duplicate ? `Already saved as ${data.purchaseNo}` : receive ? `Purchase ${data.purchaseNo} received — stock updated` : `Draft ${data.purchaseNo} saved`);
      await invalidate(...financialKeys);
      router.push(`/purchases/${data._id}`);
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 6000 }),
  });

  const submit = (receive: boolean) =>
    form.handleSubmit((values) => {
      if (!values.vendor) return toast.error('Select a vendor');
      const lines = values.items;
      if (!lines.length) return toast.error('Add at least one item');
      for (const [i, l] of lines.entries()) {
        if (!l.product) return toast.error(`Line ${i + 1}: select a product`);
        if (!(Number(l.qty) > 0)) return toast.error(`Line ${i + 1}: enter quantity`);
        if (l.unitCost === '' || Number(l.unitCost) < 0) return toast.error(`Line ${i + 1}: enter the unit cost`);
        if (l.product.data?.trackSerial && receive) {
          const units = Number(l.qty) + (Number(l.freeQty) || 0);
          if (splitSerials(l.serials).length !== units) return toast.error(`${l.product.label}: enter ${units} IMEI/serial numbers`);
        }
      }
      if (paid > totals.grandTotal) return toast.error('Amount paid cannot exceed the purchase total');
      save.mutate({ values, receive });
    })();

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Vendor" required className="sm:col-span-2">
            <Controller
              control={form.control}
              name="vendor"
              render={({ field }) => (
                <SearchSelect value={field.value} onChange={field.onChange} queryKey={qk.vendors} fetchOptions={fetchVendors} onAddNew={(t) => setNested({ kind: 'vendor', text: t })} addLabel="Add vendor" placeholder="Search vendor…" />
              )}
            />
          </Field>
          <Field label="Vendor invoice no.">
            <Input {...form.register('vendorInvoiceNo')} />
          </Field>
          <Field label="Purchase date" required>
            <Input type="date" max={toDateInput()} {...form.register('date')} />
          </Field>
          <Field label="Due date">
            <Input type="date" {...form.register('dueDate')} />
          </Field>
          <Field label="Payment terms">
            <Input {...form.register('paymentTerms')} placeholder="e.g. 15 days credit" />
          </Field>
          <Field label="Invoice / attachment reference" className="sm:col-span-2">
            <Input {...form.register('attachmentRef')} placeholder="File name, folder or link" />
          </Field>
        </div>
      </Card>

      <Card title="Items" bodyClassName="p-0" actions={<Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => items.append(emptyLine())}>Add line</Button>}>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="min-w-[16rem]">Product / spare part</th>
                <th className="w-20 text-right">Qty</th>
                <th className="w-20 text-right">Free</th>
                <th className="w-28 text-right">Unit cost</th>
                <th className="w-24 text-right">Discount</th>
                <th className="w-20 text-right">Tax %</th>
                <th className="text-right">Line total</th>
                <th className="text-right">Landed / unit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {items.fields.map((f, i) => {
                const l = watched[i];
                const p = l?.product?.data;
                return (
                  <tr key={f.id} className="align-top">
                    <td>
                      <Controller
                        control={form.control}
                        name={`items.${i}.product`}
                        render={({ field }) => (
                          <SearchSelect
                            value={field.value}
                            onChange={(o) => {
                              field.onChange(o);
                              if (o?.data && !form.getValues(`items.${i}.unitCost`)) form.setValue(`items.${i}.unitCost`, String(o.data.purchaseCost || ''));
                            }}
                            queryKey={[...qk.products, 'purchase']}
                            fetchOptions={fetchProducts(STOCK_TYPES)}
                            onAddNew={(t) => setNested({ kind: 'product', text: t, line: i })}
                            addLabel="Add product"
                          />
                        )}
                      />
                      {p && (
                        <div className="mt-1 text-xs text-slate-500">
                          {[p.category?.name, p.brand?.name, p.deviceModel?.name, p.sku && `SKU ${p.sku}`].filter(Boolean).join(' · ')} · stock {p.stockQty}
                        </div>
                      )}
                      {p?.trackSerial && (
                        <Textarea className="mt-1 font-mono text-xs" rows={2} placeholder={`IMEI / serial numbers (${(Number(l.qty) || 0) + (Number(l.freeQty) || 0)} needed) — comma or new line`} {...form.register(`items.${i}.serials`)} />
                      )}
                    </td>
                    <td>
                      <Input type="number" min={0} step="any" className="text-right" {...form.register(`items.${i}.qty`)} />
                    </td>
                    <td>
                      <Input type="number" min={0} step="any" className="text-right" {...form.register(`items.${i}.freeQty`)} placeholder="0" />
                    </td>
                    <td>
                      <MoneyInput {...form.register(`items.${i}.unitCost`)} />
                    </td>
                    <td>
                      <MoneyInput {...form.register(`items.${i}.discount`)} placeholder="0" />
                    </td>
                    <td>
                      <Input type="number" min={0} max={100} step="any" className="text-right" {...form.register(`items.${i}.taxRate`)} placeholder="0" />
                    </td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(add(totals.lines[i]?.lineTotal ?? 0, totals.lines[i]?.tax ?? 0))}</td>
                    <td className="text-right text-slate-500 tabular-nums">{formatMoney(totals.landed[i] ?? 0)}</td>
                    <td>
                      <IconButton label="Remove line" onClick={() => items.remove(i)} className="text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!items.fields.length && <EmptyState title="No items" action={<Button size="sm" onClick={() => items.append(emptyLine())}>Add line</Button>} />}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payment">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Amount paid now" hint="Leave 0 for a full credit purchase">
              <MoneyInput {...form.register('paidAmount')} placeholder="0" />
            </Field>
            <Field label="Payment method">
              <Select {...form.register('paidMethod')}>
                {methods.map((m) => (
                  <option key={m._id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference">
              <Input {...form.register('paidReference')} />
            </Field>
            <Field label="Notes" className="sm:col-span-3">
              <Textarea {...form.register('notes')} />
            </Field>
          </div>
        </Card>
        <Card title="Totals">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{formatMoney(totals.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>- {formatMoney(totals.discount)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Tax</dt><dd>{formatMoney(totals.tax)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-600">Shipping charges</dt><dd className="w-32"><MoneyInput className="h-8 py-1" {...form.register('shippingCharges')} placeholder="0" /></dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-600">Other charges</dt><dd className="w-32"><MoneyInput className="h-8 py-1" {...form.register('otherCharges')} placeholder="0" /></dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold"><dt>Grand total</dt><dd>{formatMoney(totals.grandTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Paid now</dt><dd>{formatMoney(paid)}</dd></div>
            <div className="flex justify-between font-medium text-amber-700"><dt>Balance payable (vendor credit)</dt><dd>{formatMoney(Math.max(0, totals.grandTotal - paid))}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">Charges are spread across items by value into the landed cost used for stock valuation (weighted average).</p>
        </Card>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button variant="outline" icon={<Save className="h-4 w-4" />} loading={save.isPending && !save.variables?.receive} onClick={() => submit(false)}>
          Save as draft
        </Button>
        <Button icon={<PackageCheck className="h-4 w-4" />} loading={save.isPending && save.variables?.receive} onClick={() => submit(true)}>
          Save &amp; receive stock
        </Button>
      </div>

      <VendorFormModal open={nested?.kind === 'vendor'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(v) => form.setValue('vendor', vendorOption(v))} />
      <ProductFormModal
        open={nested?.kind === 'product'}
        initialName={nested?.text}
        defaultType="SPARE_PART"
        onClose={() => setNested(null)}
        onSaved={(p) => {
          if (nested?.line !== undefined) {
            form.setValue(`items.${nested.line}.product`, productOption(p));
            form.setValue(`items.${nested.line}.unitCost`, String(p.purchaseCost || ''));
          }
        }}
      />
    </div>
  );
}
