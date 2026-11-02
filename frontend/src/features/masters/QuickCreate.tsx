'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { ApiError, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { customerService, masterService, productService, vendorService, type MasterName } from '@/services';
import type { Customer, MasterItem, Product, ProductType, Vendor } from '@/types';
import {
  clean,
  customerSchema,
  deviceModelSchema,
  masterSchema,
  productSchema,
  vendorSchema,
  type CustomerValues,
  type DeviceModelValues,
  type MasterValues,
  type ProductValues,
  type VendorValues,
} from '@/validations';
import { fetchMaster, fetchVendors, masterOption } from './options';

/** Applies API 422 field errors onto the form. */
function applyServerErrors(err: unknown, setError: (name: any, e: { message: string }) => void) {
  if (err instanceof ApiError) Object.entries(err.fieldErrors).forEach(([path, message]) => setError(path, { message }));
}

// ---------------------------------------------------------------- customers
export function CustomerFormModal({
  open,
  onClose,
  onSaved,
  customer,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (c: Customer) => void;
  customer?: Customer | null;
  initialName?: string;
}) {
  const qc = useQueryClient();
  const [dups, setDups] = useState<Array<{ _id: string; name: string; mobile: string }> | null>(null);
  const form = useForm<CustomerValues>({ resolver: zodResolver(customerSchema) });

  useEffect(() => {
    if (!open) return;
    setDups(null);
    const isMobile = initialName && /^\+?[\d\s-]{6,}$/.test(initialName);
    form.reset({
      name: customer?.name ?? (isMobile ? '' : initialName ?? ''),
      mobile: customer?.mobile ?? (isMobile ? initialName : ''),
      altMobile: customer?.altMobile ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?._id, initialName, form]);

  const save = useMutation({
    mutationFn: (args: { values: CustomerValues; allowDuplicate?: boolean }) => {
      const body = { ...clean(args.values), allowDuplicate: args.allowDuplicate };
      return customer ? customerService.update(customer._id, body) : customerService.create(body);
    },
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: qk.customers });
      toast.success(customer ? 'Customer updated' : `Customer ${c.name} added`);
      onSaved?.(c);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DUPLICATE_MOBILE') {
        setDups(((err.details as { matches?: typeof dups })?.matches ?? []) as never);
        return;
      }
      applyServerErrors(err, form.setError);
      toast.error(errorMessage(err));
    },
  });

  const submit = (allowDuplicate?: boolean) => form.handleSubmit((values) => save.mutate({ values, allowDuplicate }))();
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? 'Edit customer' : 'Add customer'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} loading={save.isPending}>
            {customer ? 'Save changes' : 'Save & select'}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          submit();
        }}
      >
        {dups && dups.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> This mobile number is already registered
            </div>
            <ul className="mt-2 space-y-1">
              {dups.map((d) => (
                <li key={d._id} className="flex items-center justify-between gap-2">
                  <span>
                    {d.name} · {d.mobile}
                  </span>
                  {!customer && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        onSaved?.(await customerService.get(d._id));
                        onClose();
                      }}
                    >
                      Use this customer
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" className="mt-2 text-amber-900" onClick={() => submit(true)}>
              Save as a separate customer anyway
            </Button>
          </div>
        )}
        <Field label="Customer name" required error={e.name?.message} className="sm:col-span-2">
          <Input {...form.register('name')} invalid={!!e.name} data-autofocus />
        </Field>
        <Field label="Mobile number" required error={e.mobile?.message}>
          <Input {...form.register('mobile')} inputMode="tel" invalid={!!e.mobile} />
        </Field>
        <Field label="Alternate number" error={e.altMobile?.message}>
          <Input {...form.register('altMobile')} inputMode="tel" invalid={!!e.altMobile} />
        </Field>
        <Field label="Email" error={e.email?.message} className="sm:col-span-2">
          <Input {...form.register('email')} type="email" invalid={!!e.email} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea {...form.register('address')} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea {...form.register('notes')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- vendors
export function VendorFormModal({
  open,
  onClose,
  onSaved,
  vendor,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (v: Vendor) => void;
  vendor?: Vendor | null;
  initialName?: string;
}) {
  const qc = useQueryClient();
  const [vendorType, setVendorType] = useState<Option<MasterItem> | null>(null);
  const [addType, setAddType] = useState<string | null>(null);
  const form = useForm<VendorValues>({ resolver: zodResolver(vendorSchema) });
  useEffect(() => {
    if (!open) return;
    form.reset({
      name: vendor?.name ?? initialName ?? '',
      contactPerson: vendor?.contactPerson ?? '',
      mobile: vendor?.mobile ?? '',
      email: vendor?.email ?? '',
      address: vendor?.address ?? '',
      taxId: vendor?.taxId ?? '',
      paymentTermsDays: vendor?.paymentTermsDays ?? 0,
      notes: vendor?.notes ?? '',
    });
    setVendorType(vendor?.vendorType ? { value: vendor.vendorType._id, label: vendor.vendorType.name } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor?._id, initialName, form]);

  const save = useMutation({
    mutationFn: (v: VendorValues & { allowDuplicate?: boolean }) => {
      const body = { ...clean(v), vendorTypeId: vendorType?.value ?? null };
      return vendor ? vendorService.update(vendor._id, body) : vendorService.create(body);
    },
    onSuccess: async (v) => {
      await qc.invalidateQueries({ queryKey: qk.vendors });
      toast.success(vendor ? 'Vendor updated' : `Vendor ${v.name} added`);
      onSaved?.(v);
      onClose();
    },
    onError: (err) => {
      applyServerErrors(err, form.setError);
      toast.error(errorMessage(err));
    },
  });
  const e = form.formState.errors;
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={vendor ? 'Edit vendor' : 'Add vendor'}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
              {vendor ? 'Save changes' : 'Save & select'}
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Vendor name" required error={e.name?.message} className="sm:col-span-2">
            <Input {...form.register('name')} invalid={!!e.name} data-autofocus />
          </Field>
          <Field label="Contact person">
            <Input {...form.register('contactPerson')} />
          </Field>
          <Field label="Contact number" error={e.mobile?.message}>
            <Input {...form.register('mobile')} inputMode="tel" invalid={!!e.mobile} />
          </Field>
          <Field label="Email" error={e.email?.message}>
            <Input {...form.register('email')} invalid={!!e.email} />
          </Field>
          <Field label="Tax / GST number">
            <Input {...form.register('taxId')} />
          </Field>
          <Field label="Vendor type">
            <SearchSelect
              value={vendorType}
              onChange={setVendorType}
              queryKey={qk.master('vendor-types')}
              fetchOptions={fetchMaster('vendor-types')}
              onAddNew={(t) => setAddType(t)}
              addLabel="Add vendor type"
            />
          </Field>
          <Field label="Payment terms (days)" error={e.paymentTermsDays?.message}>
            <Input type="number" min={0} {...form.register('paymentTermsDays')} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea {...form.register('address')} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea {...form.register('notes')} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>
      <MasterFormModal master="vendor-types" label="Vendor type" open={addType !== null} initialName={addType ?? ''} onClose={() => setAddType(null)} onSaved={(m) => setVendorType(masterOption(m))} />
    </>
  );
}

// ---------------------------------------------------------------- generic masters
export function MasterFormModal({
  master,
  label,
  open,
  onClose,
  onSaved,
  initialName,
  item,
}: {
  master: MasterName;
  label: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (m: MasterItem) => void;
  initialName?: string;
  item?: MasterItem | null;
}) {
  const qc = useQueryClient();
  const form = useForm<MasterValues>({ resolver: zodResolver(masterSchema) });
  useEffect(() => {
    if (open) form.reset({ name: item?.name ?? initialName ?? '', description: item?.description ?? '', kind: item?.kind ?? (master === 'payment-methods' ? 'OTHER' : 'OPERATING') });
  }, [open, initialName, item, master, form]);
  const save = useMutation({
    mutationFn: (v: MasterValues) => {
      const body: Record<string, unknown> = { name: v.name, description: v.description || undefined };
      if (master === 'expense-categories' || master === 'payment-methods') body.kind = v.kind;
      return item ? masterService.update(master, item._id, body) : masterService.create(master, body);
    },
    onSuccess: async (m) => {
      await qc.invalidateQueries({ queryKey: qk.master(master) });
      toast.success(`${label} saved`);
      onSaved?.(m);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DUPLICATE') {
        const existing = (err.details as { existing?: MasterItem })?.existing;
        if (existing && !item) {
          toast.info(`${label} "${existing.name}" already exists - selected it`);
          onSaved?.(existing);
          onClose();
          return;
        }
      }
      applyServerErrors(err, form.setError);
      toast.error(errorMessage(err));
    },
  });
  const e = form.formState.errors;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={item ? `Edit ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Field label="Name" required error={e.name?.message}>
          <Input {...form.register('name')} invalid={!!e.name} data-autofocus />
        </Field>
        {master === 'expense-categories' && (
          <Field label="Reporting group" hint="Operating expenses reduce operating profit; other expenses appear below it.">
            <Select {...form.register('kind')}>
              <option value="OPERATING">Operating expense</option>
              <option value="OTHER">Other expense</option>
            </Select>
          </Field>
        )}
        {master === 'payment-methods' && (
          <Field label="Type" hint="Only Cash methods can give change.">
            <Select {...form.register('kind')}>
              <option value="CASH">Cash</option>
              <option value="DIGITAL">Digital / UPI</option>
              <option value="CARD">Card</option>
              <option value="BANK">Bank</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
        )}
        <Field label="Description">
          <Input {...form.register('description')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- device models
export function DeviceModelFormModal({
  open,
  onClose,
  onSaved,
  initialName,
  brand: initialBrand,
  deviceCategory: initialCategory,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (m: MasterItem) => void;
  initialName?: string;
  brand?: Option<MasterItem> | null;
  deviceCategory?: Option<MasterItem> | null;
}) {
  const qc = useQueryClient();
  const [brand, setBrand] = useState<Option<MasterItem> | null>(null);
  const [category, setCategory] = useState<Option<MasterItem> | null>(null);
  const [addBrand, setAddBrand] = useState<string | null>(null);
  const form = useForm<DeviceModelValues>({ resolver: zodResolver(deviceModelSchema) });
  useEffect(() => {
    if (!open) return;
    setBrand(initialBrand ?? null);
    setCategory(initialCategory ?? null);
    form.reset({ name: initialName ?? '', brand: initialBrand?.value ?? '', deviceCategory: initialCategory?.value ?? '' });
  }, [open, initialName, initialBrand, initialCategory, form]);
  const save = useMutation({
    mutationFn: (v: DeviceModelValues) => masterService.create('device-models', { name: v.name, brand: v.brand, deviceCategory: v.deviceCategory || undefined }),
    onSuccess: async (m) => {
      await qc.invalidateQueries({ queryKey: qk.master('device-models') });
      toast.success('Model saved');
      onSaved?.({ ...m, brand: brand ? { _id: brand.value, name: brand.label } : m.brand });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'DUPLICATE' && (err.details as { existing?: MasterItem })?.existing) {
        onSaved?.((err.details as { existing: MasterItem }).existing);
        toast.info('Model already exists - selected it');
        onClose();
        return;
      }
      toast.error(errorMessage(err));
    },
  });
  const e = form.formState.errors;
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="sm"
        title="Add device model"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Brand" required error={e.brand?.message}>
            <SearchSelect
              value={brand}
              onChange={(o) => {
                setBrand(o);
                form.setValue('brand', o?.value ?? '', { shouldValidate: true });
              }}
              queryKey={qk.master('brands')}
              fetchOptions={fetchMaster('brands')}
              onAddNew={(t) => setAddBrand(t)}
              addLabel="Add brand"
              invalid={!!e.brand}
            />
          </Field>
          <Field label="Model name" required error={e.name?.message}>
            <Input {...form.register('name')} invalid={!!e.name} data-autofocus />
          </Field>
          <Field label="Device category">
            <SearchSelect
              value={category}
              onChange={(o) => {
                setCategory(o);
                form.setValue('deviceCategory', o?.value ?? '');
              }}
              queryKey={qk.master('device-categories')}
              fetchOptions={fetchMaster('device-categories')}
            />
          </Field>
        </div>
      </Modal>
      <MasterFormModal
        master="brands"
        label="Brand"
        open={addBrand !== null}
        initialName={addBrand ?? ''}
        onClose={() => setAddBrand(null)}
        onSaved={(m) => {
          setBrand(masterOption(m));
          form.setValue('brand', m._id, { shouldValidate: true });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- products
const productTypes: Array<{ value: ProductType; label: string }> = [
  { value: 'PHONE', label: 'Mobile phone / device' },
  { value: 'SPARE_PART', label: 'Spare part' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'CONSUMABLE', label: 'Repair consumable' },
  { value: 'SERVICE', label: 'Service (no stock)' },
  { value: 'OTHER', label: 'Other' },
];

export function ProductFormModal({
  open,
  onClose,
  onSaved,
  product,
  defaultType = 'ACCESSORY',
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (p: Product) => void;
  product?: Product | null;
  defaultType?: ProductType;
  initialName?: string;
}) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<Option<MasterItem> | null>(null);
  const [brand, setBrand] = useState<Option<MasterItem> | null>(null);
  const [model, setModel] = useState<Option<MasterItem> | null>(null);
  const [vendor, setVendor] = useState<Option<Vendor> | null>(null);
  const [nested, setNested] = useState<{ kind: 'category' | 'brand' | 'model' | 'vendor'; text: string } | null>(null);
  const form = useForm<ProductValues>({ resolver: zodResolver(productSchema) });

  useEffect(() => {
    if (!open) return;
    const p = product;
    form.reset({
      name: p?.name ?? initialName ?? '',
      productType: p?.productType ?? defaultType,
      sku: p?.sku ?? '',
      barcode: p?.barcode ?? '',
      sellingPrice: p?.sellingPrice ?? 0,
      purchaseCost: p?.purchaseCost ?? 0,
      taxRate: p?.taxRate ?? '',
      minStock: p?.minStock ?? undefined,
      unit: p?.unit ?? 'pcs',
      warrantyMonths: p?.warrantyMonths ?? 0,
      trackSerial: p?.trackSerial ?? defaultType === 'PHONE',
      description: p?.description ?? '',
      openingQty: 0,
      openingCost: 0,
      openingSerials: '',
    });
    setCategory(p?.category ? { value: p.category._id, label: p.category.name } : null);
    setBrand(p?.brand ? { value: p.brand._id, label: p.brand.name } : null);
    setModel(p?.deviceModel ? { value: p.deviceModel._id, label: p.deviceModel.name } : null);
    setVendor(p?.preferredVendor ? { value: p.preferredVendor._id, label: p.preferredVendor.name } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?._id, defaultType, initialName, form]);

  const type = form.watch('productType');
  const trackSerial = form.watch('trackSerial');
  const openingQty = Number(form.watch('openingQty') || 0);

  const save = useMutation({
    mutationFn: (v: ProductValues) => {
      const body: Record<string, unknown> = {
        name: v.name,
        productType: v.productType,
        sku: v.sku || undefined,
        barcode: v.barcode || undefined,
        sellingPrice: Number(v.sellingPrice),
        purchaseCost: v.purchaseCost !== undefined ? Number(v.purchaseCost) : undefined,
        taxRate: v.taxRate === '' || v.taxRate === undefined ? null : Number(v.taxRate),
        minStock: v.minStock !== undefined && String(v.minStock) !== '' ? Number(v.minStock) : undefined,
        unit: v.unit || 'pcs',
        warrantyMonths: Number(v.warrantyMonths || 0),
        trackSerial: v.productType === 'SERVICE' ? false : Boolean(v.trackSerial),
        description: v.description || undefined,
        categoryId: category?.value ?? null,
        brandId: brand?.value ?? null,
        deviceModelId: model?.value ?? null,
        preferredVendorId: vendor?.value ?? null,
      };
      if (!product && v.productType !== 'SERVICE' && Number(v.openingQty) > 0) {
        body.openingStock = {
          qty: Number(v.openingQty),
          unitCost: Number(v.openingCost || v.purchaseCost || 0),
          serials: (v.openingSerials ?? '').split(/[\s,]+/).filter(Boolean),
        };
      }
      return product ? productService.update(product._id, body) : productService.create(body);
    },
    onSuccess: async (p) => {
      await Promise.all([qc.invalidateQueries({ queryKey: qk.products }), qc.invalidateQueries({ queryKey: qk.inventory })]);
      toast.success(product ? 'Product updated' : `${p.name} added`);
      onSaved?.(p);
      onClose();
    },
    onError: (err) => {
      applyServerErrors(err, form.setError);
      toast.error(errorMessage(err));
    },
  });
  const e = form.formState.errors;
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title={product ? `Edit ${product.name}` : 'Add product / spare part / service'}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={form.handleSubmit((v) => save.mutate(v))} loading={save.isPending}>
              {product ? 'Save changes' : 'Save & select'}
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Field label="Product name" required error={e.name?.message} className="sm:col-span-2">
            <Input {...form.register('name')} invalid={!!e.name} data-autofocus />
          </Field>
          <Field label="Type" required>
            <Select {...form.register('productType')}>
              {productTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <SearchSelect value={category} onChange={setCategory} queryKey={qk.master('product-categories')} fetchOptions={fetchMaster('product-categories')} onAddNew={(t) => setNested({ kind: 'category', text: t })} addLabel="Add category" />
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
            <SearchSelect
              value={model}
              onChange={setModel}
              queryKey={[...qk.master('device-models'), brand?.value]}
              fetchOptions={fetchMaster('device-models', { brand: brand?.value })}
              onAddNew={(t) => setNested({ kind: 'model', text: t })}
              addLabel="Add model"
            />
          </Field>
          <Field label="SKU / item code" error={e.sku?.message}>
            <Input {...form.register('sku')} />
          </Field>
          <Field label="Barcode" error={e.barcode?.message}>
            <Input {...form.register('barcode')} />
          </Field>
          <Field label="Selling price" required error={e.sellingPrice?.message}>
            <MoneyInput {...form.register('sellingPrice')} invalid={!!e.sellingPrice} />
          </Field>
          <Field label="Purchase cost (reference)" hint="Stock cost is set by purchases (weighted average).">
            <MoneyInput {...form.register('purchaseCost')} />
          </Field>
          <Field label="Tax rate %" hint="Blank = shop default">
            <Input type="number" step="any" min={0} max={100} {...form.register('taxRate')} />
          </Field>
          <Field label="Warranty (months)">
            <Input type="number" min={0} {...form.register('warrantyMonths')} />
          </Field>
          {type !== 'SERVICE' && (
            <>
              <Field label="Minimum stock" hint="Low-stock alert level">
                <Input type="number" min={0} step="any" {...form.register('minStock')} />
              </Field>
              <Field label="Unit">
                <Input {...form.register('unit')} />
              </Field>
              <Field label="Preferred vendor" className="sm:col-span-2">
                <SearchSelect value={vendor} onChange={setVendor} queryKey={qk.vendors} fetchOptions={fetchVendors} onAddNew={(t) => setNested({ kind: 'vendor', text: t })} addLabel="Add vendor" />
              </Field>
              <div className="flex items-end pb-2 sm:col-span-2">
                <Controller
                  control={form.control}
                  name="trackSerial"
                  render={({ field }) => <Checkbox label="Track IMEI / serial numbers for each unit" checked={!!field.value} onChange={(ev) => field.onChange(ev.target.checked)} disabled={!!product && product.stockQty !== 0} />}
                />
              </div>
            </>
          )}
          {!product && type !== 'SERVICE' && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-4">
              <div className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">Opening stock (optional) — recorded as an OPENING stock movement. For new stock use the Purchase module.</div>
              <Field label="Opening quantity">
                <Input type="number" min={0} step="any" {...form.register('openingQty')} />
              </Field>
              <Field label="Unit cost">
                <MoneyInput {...form.register('openingCost')} />
              </Field>
              {trackSerial && openingQty > 0 && (
                <Field label="IMEI / serial numbers" error={e.openingSerials?.message} className="sm:col-span-2" hint="Separate with commas, spaces or new lines">
                  <Textarea {...form.register('openingSerials')} rows={2} invalid={!!e.openingSerials} />
                </Field>
              )}
            </div>
          )}
          <Field label="Description" className="sm:col-span-2 lg:col-span-4">
            <Textarea {...form.register('description')} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>
      <MasterFormModal master="product-categories" label="Category" open={nested?.kind === 'category'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(m) => setCategory(masterOption(m))} />
      <MasterFormModal master="brands" label="Brand" open={nested?.kind === 'brand'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(m) => setBrand(masterOption(m))} />
      <DeviceModelFormModal open={nested?.kind === 'model'} initialName={nested?.text} brand={brand} onClose={() => setNested(null)} onSaved={(m) => setModel(masterOption(m))} />
      <VendorFormModal open={nested?.kind === 'vendor'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(v) => setVendor({ value: v._id, label: v.name, data: v })} />
    </>
  );
}
