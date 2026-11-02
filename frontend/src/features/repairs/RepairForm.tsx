'use client';

import { useMutation } from '@tanstack/react-query';
import { Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Card } from '@/components/ui/Misc';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { CustomerFormModal, DeviceModelFormModal, MasterFormModal, ProductFormModal } from '@/features/masters/QuickCreate';
import { customerOption, fetchCustomers, fetchMaster, fetchProducts, masterOption, productOption } from '@/features/masters/options';
import { PaymentRows, emptyPayRow, payRowsToApi, payRowsTotal, type PayRow } from '@/features/payments/PaymentRows';
import { useInvalidate, useSettings, useTechnicians } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { add, mul, sub } from '@/lib/money';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatMoney, formatNumber, openPrint, printInBackground, toDateInput } from '@/lib/utils';
import { repairService } from '@/services';
import type { Customer, MasterItem, Product, RepairJob } from '@/types';

interface PartRow {
  product: Option<Product> | null;
  qty: string;
  unitPrice: string;
}

export function RepairForm({ repair, initialCustomer }: { repair?: Omit<RepairJob, 'sale'>; initialCustomer?: Customer | null }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const { data: settings } = useSettings();
  const { data: technicians = [] } = useTechnicians();
  const requestId = useRef(newRequestId());
  const [customer, setCustomer] = useState<Option<Customer> | null>(null);
  const [contact, setContact] = useState('');
  const [deviceCategory, setDeviceCategory] = useState<Option<MasterItem> | null>(null);
  const [brand, setBrand] = useState<Option<MasterItem> | null>(null);
  const [model, setModel] = useState<Option<MasterItem> | null>(null);
  const [f, setF] = useState({
    imei: '',
    conditionAtReceipt: '',
    accessoriesReceived: '',
    complaint: '',
    diagnosis: '',
    estimatedCost: '',
    approvedCost: '',
    technicianId: '',
    expectedDeliveryAt: '',
    laborCharge: '',
    discount: '',
    warrantyType: 'NONE',
    warrantyDays: '',
    internalNotes: '',
    customerNotes: '',
  });
  const [parts, setParts] = useState<PartRow[]>([]);
  const [advance, setAdvance] = useState<PayRow[]>([emptyPayRow()]);
  const [nested, setNested] = useState<{ kind: 'customer' | 'deviceCategory' | 'brand' | 'model' | 'part'; text: string; line?: number } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (repair) {
      setCustomer({ value: repair.customer, label: repair.customerName });
      setContact(repair.contactNumber ?? '');
      setDeviceCategory(repair.deviceCategory ? { value: repair.deviceCategory, label: repair.deviceCategoryName ?? '' } : null);
      setBrand(repair.brand ? { value: repair.brand, label: repair.brandName ?? '' } : null);
      setModel(repair.deviceModel ? { value: repair.deviceModel, label: repair.deviceModelName ?? '' } : null);
      setF({
        imei: repair.imei ?? '',
        conditionAtReceipt: repair.conditionAtReceipt ?? '',
        accessoriesReceived: repair.accessoriesReceived ?? '',
        complaint: repair.complaint ?? '',
        diagnosis: repair.diagnosis ?? '',
        estimatedCost: repair.estimatedCost ? String(repair.estimatedCost) : '',
        approvedCost: repair.approvedCost ? String(repair.approvedCost) : '',
        technicianId: repair.technician ?? '',
        expectedDeliveryAt: repair.expectedDeliveryAt ? toDateInput(new Date(repair.expectedDeliveryAt)) : '',
        laborCharge: repair.laborCharge ? String(repair.laborCharge) : '',
        discount: repair.discount ? String(repair.discount) : '',
        warrantyType: repair.warrantyType,
        warrantyDays: repair.warrantyDays ? String(repair.warrantyDays) : '',
        internalNotes: repair.internalNotes ?? '',
        customerNotes: repair.customerNotes ?? '',
      });
      setParts(repair.parts.map((p) => ({ product: { value: p.product, label: p.name }, qty: String(p.qty), unitPrice: String(p.unitPrice) })));
    } else if (initialCustomer) {
      setCustomer(customerOption(initialCustomer));
      setContact(initialCustomer.mobile ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repair?._id, initialCustomer?._id]);

  useEffect(() => {
    if (!repair && settings) {
      setF((s) => ({ ...s, warrantyDays: s.warrantyDays || String(settings.warranty?.defaultRepairDays ?? '') }));
      setAdvance([emptyPayRow(settings.billing?.defaultPaymentMethod)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.billing?.defaultPaymentMethod, repair?._id]);

  const partsTotal = useMemo(() => add(...parts.map((p) => mul(Number(p.unitPrice) || 0, Number(p.qty) || 0))), [parts]);
  const total = sub(add(Number(f.laborCharge) || 0, partsTotal), Number(f.discount) || 0);

  const save = useMutation({
    mutationFn: async (_vars: { print: boolean }) => {
      const body: Record<string, unknown> = {
        contactNumber: contact || undefined,
        deviceCategoryId: deviceCategory?.value ?? '',
        brandId: brand?.value ?? '',
        deviceModelId: model?.value ?? '',
        imei: f.imei,
        conditionAtReceipt: f.conditionAtReceipt,
        accessoriesReceived: f.accessoriesReceived,
        complaint: f.complaint,
        diagnosis: f.diagnosis,
        estimatedCost: Number(f.estimatedCost) || 0,
        approvedCost: Number(f.approvedCost) || 0,
        technicianId: f.technicianId,
        expectedDeliveryAt: f.expectedDeliveryAt || undefined,
        laborCharge: Number(f.laborCharge) || 0,
        discount: Number(f.discount) || 0,
        warrantyType: f.warrantyType,
        warrantyDays: Number(f.warrantyDays) || 0,
        internalNotes: f.internalNotes,
        customerNotes: f.customerNotes,
        parts: parts.filter((p) => p.product).map((p) => ({ productId: p.product!.value, qty: Number(p.qty) || 1, unitPrice: Number(p.unitPrice) || 0 })),
      };
      if (repair) return { data: await repairService.update(repair._id, body), meta: undefined };
      const adv = payRowsToApi(advance);
      return repairService.create({ ...body, clientRequestId: requestId.current, customerId: customer?.value, advance: adv.length ? { methods: adv } : undefined });
    },
    onSuccess: async ({ data, meta }, { print }) => {
      const printUrl = `/print/repair/${data._id}?print=1`;
      if (print) printInBackground(printUrl);
      toast.success(repair ? 'Job updated' : meta?.duplicate ? `Already saved as ${data.jobNo}` : `Job ${data.jobNo} created`, repair || print ? undefined : { action: { label: 'Print receipt', onClick: () => openPrint(printUrl) } });
      await invalidate(...financialKeys);
      router.push(`/repairs/${data._id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = (print = false) => {
    if (!customer) return toast.error('Select the customer');
    if (customer.data?.isWalkIn) return toast.error('Repair jobs need a registered customer');
    if (!f.complaint.trim()) return toast.error('Enter the customer complaint');
    if (parts.some((p) => !p.product)) return toast.error('Select a spare part on every part line or remove it');
    save.mutate({ print });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Customer & device">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer" required className="sm:col-span-2">
              <SearchSelect
                value={customer}
                onChange={(o) => {
                  setCustomer(o);
                  if (o?.data?.mobile) setContact(o.data.mobile);
                }}
                queryKey={qk.customers}
                fetchOptions={fetchCustomers}
                onAddNew={repair ? undefined : (t) => setNested({ kind: 'customer', text: t })}
                addLabel="Add customer"
                disabled={!!repair}
              />
            </Field>
            <Field label="Contact number">
              <Input value={contact} onChange={(e) => setContact(e.target.value)} inputMode="tel" />
            </Field>
            <Field label="Device category">
              <SearchSelect value={deviceCategory} onChange={setDeviceCategory} queryKey={qk.master('device-categories')} fetchOptions={fetchMaster('device-categories')} onAddNew={(t) => setNested({ kind: 'deviceCategory', text: t })} addLabel="Add device category" />
            </Field>
            <Field label="Brand">
              <SearchSelect
                value={brand}
                onChange={(o) => {
                  setBrand(o);
                  setModel(null);
                }}
                queryKey={qk.master('brands')}
                fetchOptions={fetchMaster('brands')}
                onAddNew={(t) => setNested({ kind: 'brand', text: t })}
                addLabel="Add brand"
              />
            </Field>
            <Field label="Model">
              <SearchSelect value={model} onChange={setModel} queryKey={[...qk.master('device-models'), brand?.value]} fetchOptions={fetchMaster('device-models', { brand: brand?.value })} onAddNew={(t) => setNested({ kind: 'model', text: t })} addLabel="Add model" />
            </Field>
            <Field label="IMEI / serial (optional)">
              <Input value={f.imei} onChange={set('imei')} />
            </Field>
            <Field label="Accessories received">
              <Input value={f.accessoriesReceived} onChange={set('accessoriesReceived')} placeholder="e.g. SIM tray, back cover" />
            </Field>
            <Field label="Device condition at receipt" className="sm:col-span-2">
              <Textarea value={f.conditionAtReceipt} onChange={set('conditionAtReceipt')} placeholder="Scratches, dents, display state, powers on?" />
            </Field>
          </div>
        </Card>
        <Card title="Job details">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer complaint" required className="sm:col-span-2">
              <Textarea value={f.complaint} onChange={set('complaint')} />
            </Field>
            <Field label="Diagnosis" className="sm:col-span-2">
              <Textarea value={f.diagnosis} onChange={set('diagnosis')} />
            </Field>
            <Field label="Estimated cost">
              <MoneyInput value={f.estimatedCost} onChange={set('estimatedCost')} />
            </Field>
            <Field label="Approved cost">
              <MoneyInput value={f.approvedCost} onChange={set('approvedCost')} />
            </Field>
            <Field label="Assigned technician">
              <Select value={f.technicianId} onChange={set('technicianId')}>
                <option value="">Unassigned</option>
                {technicians.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expected delivery">
              <Input type="date" value={f.expectedDeliveryAt} onChange={set('expectedDeliveryAt')} min={toDateInput()} />
            </Field>
            <Field label="Repair warranty">
              <Select value={f.warrantyType} onChange={set('warrantyType')}>
                <option value="NONE">No warranty</option>
                <option value="LABOR">Labour only</option>
                <option value="PARTS">Parts only</option>
                <option value="FULL">Parts &amp; labour</option>
              </Select>
            </Field>
            <Field label="Warranty period (days)">
              <Input type="number" min={0} value={f.warrantyDays} onChange={set('warrantyDays')} disabled={f.warrantyType === 'NONE'} />
            </Field>
          </div>
        </Card>
      </div>

      <Card title="Charges & spare parts" actions={<Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setParts([...parts, { product: null, qty: '1', unitPrice: '' }])}>Add spare part</Button>}>
        <p className="mb-3 text-xs text-slate-500">Spare parts are reserved on the job and deducted from stock only once, when the job is completed and invoiced.</p>
        {parts.length > 0 && (
          <div className="mb-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="min-w-[16rem]">Spare part</th>
                  <th className="w-24 text-right">Qty</th>
                  <th className="w-32 text-right">Price</th>
                  <th className="text-right">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {parts.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <SearchSelect
                        value={p.product}
                        onChange={(o) => setParts(parts.map((x, j) => (j === i ? { ...x, product: o, unitPrice: x.unitPrice || String(o?.data?.sellingPrice ?? '') } : x)))}
                        queryKey={[...qk.products, 'spares']}
                        fetchOptions={fetchProducts('SPARE_PART,CONSUMABLE,ACCESSORY')}
                        onAddNew={(t) => setNested({ kind: 'part', text: t, line: i })}
                        addLabel="Add spare part"
                      />
                      {p.product?.data && <span className="text-xs text-slate-500">In stock {formatNumber(p.product.data.stockQty)}</span>}
                    </td>
                    <td>
                      <Input type="number" min={0} step="any" className="text-right" value={p.qty} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                    </td>
                    <td>
                      <MoneyInput value={p.unitPrice} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                    </td>
                    <td className="text-right">{formatMoney(mul(Number(p.unitPrice) || 0, Number(p.qty) || 0))}</td>
                    <td>
                      <IconButton label="Remove part" onClick={() => setParts(parts.filter((_, j) => j !== i))} className="text-red-500 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Labour / service charge">
            <MoneyInput value={f.laborCharge} onChange={set('laborCharge')} />
          </Field>
          <Field label="Discount">
            <MoneyInput value={f.discount} onChange={set('discount')} />
          </Field>
          <div className="rounded-lg bg-slate-50 p-3 text-sm sm:col-span-2">
            <div className="flex justify-between">
              <span>Parts</span>
              <span>{formatMoney(partsTotal)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Estimated bill</span>
              <span>{formatMoney(total)}</span>
            </div>
            {repair && (
              <div className="flex justify-between text-slate-600">
                <span>Advance paid</span>
                <span>{formatMoney(repair.advancePaid)}</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Notes">
          <div className="grid gap-3">
            <Field label="Customer-visible notes" hint="Printed on the job receipt">
              <Textarea value={f.customerNotes} onChange={set('customerNotes')} />
            </Field>
            <Field label="Internal notes" hint="Staff only">
              <Textarea value={f.internalNotes} onChange={set('internalNotes')} />
            </Field>
          </div>
        </Card>
        {!repair && (
          <Card title="Advance payment (optional)">
            <PaymentRows rows={advance} onChange={setAdvance} />
            <p className="mt-2 text-xs text-slate-500">
              Advance {formatMoney(payRowsTotal(advance))} is credited to the customer and applied to the final invoice.
            </p>
          </Card>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        {!repair && (
          <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => submit(true)} loading={save.isPending && save.variables?.print} disabled={save.isPending}>
            Create job &amp; print receipt
          </Button>
        )}
        <Button icon={<Save className="h-4 w-4" />} onClick={() => submit()} loading={save.isPending && !save.variables?.print} disabled={save.isPending}>
          {repair ? 'Save changes' : 'Create job'}
        </Button>
      </div>

      <CustomerFormModal
        open={nested?.kind === 'customer'}
        initialName={nested?.text}
        onClose={() => setNested(null)}
        onSaved={(c) => {
          setCustomer(customerOption(c));
          setContact(c.mobile ?? '');
        }}
      />
      <MasterFormModal master="device-categories" label="Device category" open={nested?.kind === 'deviceCategory'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(m) => setDeviceCategory(masterOption(m))} />
      <MasterFormModal master="brands" label="Brand" open={nested?.kind === 'brand'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(m) => setBrand(masterOption(m))} />
      <DeviceModelFormModal open={nested?.kind === 'model'} initialName={nested?.text} brand={brand} deviceCategory={deviceCategory} onClose={() => setNested(null)} onSaved={(m) => setModel(masterOption(m))} />
      <ProductFormModal
        open={nested?.kind === 'part'}
        initialName={nested?.text}
        defaultType="SPARE_PART"
        onClose={() => setNested(null)}
        onSaved={(p) => nested?.line !== undefined && setParts(parts.map((x, j) => (j === nested.line ? { ...x, product: productOption(p), unitPrice: String(p.sellingPrice) } : x)))}
      />
    </div>
  );
}
