'use client';

import { Barcode, Package, Plus, Wrench } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/Field';
import { SearchSelect, type Option, type SearchSelectHandle } from '@/components/ui/SearchSelect';
import { DeviceModelFormModal, MasterFormModal, ProductFormModal, VendorFormModal } from '@/features/masters/QuickCreate';
import { fetchMaster, fetchProducts, fetchVendors, masterOption, productOption, vendorOption } from '@/features/masters/options';
import { errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { cn, formatNumber } from '@/lib/utils';
import { productService } from '@/services';
import type { MasterItem, Product, ProductType, Vendor } from '@/types';
import { SerialPicker } from './SerialPicker';
import type { BillItem, WarrantyStatus } from './types';

const STOCK_TYPES = 'PHONE,SPARE_PART,ACCESSORY,CONSUMABLE,OTHER';
let keySeq = 0;
const newKey = () => `l${Date.now()}${keySeq++}`;

export interface ItemEntryHandle {
  focusSearch: () => void;
}

type Nested =
  | { kind: 'product'; text: string; type: ProductType }
  | { kind: 'spare'; text: string }
  | { kind: 'deviceCategory' | 'brand' | 'model' | 'dealer'; text: string }
  | null;

export const ItemEntry = forwardRef<ItemEntryHandle, { onAdd: (item: BillItem) => void; canManual: boolean; existingSerials: string[] }>(function ItemEntry(
  { onAdd, canManual, existingSerials },
  ref,
) {
  const [mode, setMode] = useState<'PRODUCT' | 'SERVICE'>('PRODUCT');
  const [product, setProduct] = useState<Option<Product> | null>(null);
  const [manualName, setManualName] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [serials, setSerials] = useState<string[]>([]);
  const [deviceCategory, setDeviceCategory] = useState<Option<MasterItem> | null>(null);
  const [brand, setBrand] = useState<Option<MasterItem> | null>(null);
  const [model, setModel] = useState<Option<MasterItem> | null>(null);
  const [imei, setImei] = useState('');
  const [complaint, setComplaint] = useState('');
  const [spare, setSpare] = useState<Option<Product> | null>(null);
  const [spareQty, setSpareQty] = useState('1');
  const [dealer, setDealer] = useState<Option<Vendor> | null>(null);
  const [warranty, setWarranty] = useState<WarrantyStatus>('NONE');
  const [wStart, setWStart] = useState('');
  const [wEnd, setWEnd] = useState('');
  const [code, setCode] = useState('');
  const [nested, setNested] = useState<Nested>(null);
  const searchRef = useRef<SearchSelectHandle>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }));

  const p = product?.data;
  const isService = mode === 'SERVICE';

  const reset = () => {
    setProduct(null);
    setManualName('');
    setQty('1');
    setPrice('');
    setDiscount('');
    setSerials([]);
    setImei('');
    setComplaint('');
    setSpare(null);
    setSpareQty('1');
    setDealer(null);
    setWarranty('NONE');
    setWStart('');
    setWEnd('');
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const selectProduct = (opt: Option<Product> | null) => {
    setProduct(opt);
    setSerials([]);
    if (opt?.data) {
      setPrice(String(opt.data.sellingPrice ?? 0));
      if (opt.data.brand) setBrand({ value: opt.data.brand._id, label: opt.data.brand.name });
      setTimeout(() => qtyRef.current?.focus(), 0);
    }
  };

  const add = () => {
    const q = Number(qty);
    const unitPrice = Number(price);
    if (!p && !(isService && manualName.trim())) return toast.error(isService ? 'Select a service or type a description' : 'Select a product');
    if (!p && !canManual) return toast.error('You are not allowed to add manual items');
    if (!(q > 0)) return toast.error('Enter a quantity');
    if (!(unitPrice >= 0) || price === '') return toast.error('Enter the price');
    if (p?.trackSerial && serials.length !== q) return toast.error(`Select ${q} IMEI/serial number(s)`);
    const disc = Number(discount || 0);
    if (disc > unitPrice * q) return toast.error('Discount cannot exceed the line amount');
    const lineIsService = isService || p?.trackInventory === false;
    onAdd({
      key: newKey(),
      itemType: lineIsService ? 'SERVICE' : 'PRODUCT',
      productId: p?._id,
      name: p?.name ?? manualName.trim(),
      category: p?.category?.name ?? (lineIsService ? 'Service' : undefined),
      description: [brand?.label, model?.label].filter(Boolean).join(' ') || undefined,
      qty: q,
      unitPrice,
      discount: disc,
      taxRate: p?.taxRate ?? undefined,
      stock: p?.trackInventory ? p.stockQty : undefined,
      unit: p?.unit,
      trackInventory: p?.trackInventory,
      trackSerial: p?.trackSerial,
      serials,
      device: lineIsService
        ? {
            deviceCategoryId: deviceCategory?.value,
            deviceCategoryName: deviceCategory?.label,
            brandId: brand?.value,
            brandName: brand?.label,
            deviceModelId: model?.value,
            deviceModelName: model?.label,
            imei: imei.trim() || undefined,
          }
        : undefined,
      complaint: lineIsService ? complaint.trim() || undefined : undefined,
      sparePart:
        lineIsService && spare?.data
          ? { productId: spare.data._id, name: spare.data.name, qty: Number(spareQty) || 1, stock: spare.data.stockQty, dealerId: dealer?.value, dealerName: dealer?.label }
          : undefined,
      warranty: warranty !== 'NONE' ? { status: warranty, startDate: wStart || undefined, expiryDate: wEnd || undefined } : undefined,
    });
    reset();
  };

  const lookup = async () => {
    const c = code.trim();
    if (!c) return;
    try {
      const res = await productService.lookup(c);
      setCode('');
      const prod = res.product;
      if (!prod) return;
      if (res.serial && res.serial.status !== 'IN_STOCK') return toast.error(`IMEI ${res.serial.serial} is ${res.serial.status.toLowerCase().replace(/_/g, ' ')}`);
      if (res.serial && existingSerials.includes(res.serial.serial)) return toast.error('This IMEI is already on the bill');
      setMode(prod.productType === 'SERVICE' ? 'SERVICE' : 'PRODUCT');
      // Barcode scan of a non-serial item adds it straight to the bill.
      if (!prod.trackSerial || res.serial) {
        onAdd({
          key: newKey(),
          itemType: prod.trackInventory ? 'PRODUCT' : 'SERVICE',
          productId: prod._id,
          name: prod.name,
          category: prod.category?.name,
          qty: 1,
          unitPrice: prod.sellingPrice,
          discount: 0,
          taxRate: prod.taxRate ?? undefined,
          stock: prod.trackInventory ? prod.stockQty : undefined,
          unit: prod.unit,
          trackInventory: prod.trackInventory,
          trackSerial: prod.trackSerial,
          serials: res.serial ? [res.serial.serial] : [],
        });
        toast.success(`Added ${prod.name}`);
      } else {
        selectProduct(productOption(prod));
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const enterAdds = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Item type" className="inline-flex rounded-lg bg-slate-100 p-1">
          {(
            [
              ['PRODUCT', 'Product', Package],
              ['SERVICE', 'Repair / Service', Wrench],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={mode === v}
              onClick={() => {
                setMode(v);
                setProduct(null);
                setPrice('');
              }}
              className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', mode === v ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Barcode className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Scan barcode / SKU / IMEI"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void lookup();
              }
            }}
            aria-label="Scan barcode, SKU or IMEI"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
        <Field label={isService ? 'Service (F2)' : 'Product (F2)'} className="col-span-2 md:col-span-5">
          <SearchSelect
            ref={searchRef}
            value={product}
            onChange={selectProduct}
            queryKey={[...qk.products, mode]}
            fetchOptions={fetchProducts(isService ? 'SERVICE' : STOCK_TYPES)}
            placeholder={isService ? 'Search services…' : 'Search name, SKU, code…'}
            onAddNew={(t) => setNested({ kind: 'product', text: t, type: isService ? 'SERVICE' : 'ACCESSORY' })}
            addLabel={isService ? 'Add service item' : 'Add product'}
          />
          {p?.trackInventory && (
            <span className={cn('mt-1 text-xs', p.stockQty <= 0 ? 'text-red-600' : 'text-slate-500')}>
              In stock: {formatNumber(p.stockQty)} {p.unit}
            </span>
          )}
        </Field>
        {isService && !p && (
          <Field label="Or describe the service" className="col-span-2 md:col-span-7">
            <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="e.g. Screen replacement" disabled={!canManual} onKeyDown={enterAdds} />
          </Field>
        )}
        <Field label="Qty" className="md:col-span-2">
          <Input ref={qtyRef} type="number" min={0} step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.currentTarget.select()} onKeyDown={enterAdds} />
        </Field>
        <Field label="Unit price" className="md:col-span-2">
          <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)} onKeyDown={enterAdds} />
        </Field>
        <Field label="Discount" className="md:col-span-2">
          <MoneyInput value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" onKeyDown={enterAdds} />
        </Field>
        {/* Invisible label keeps the button level with the inputs, so the "In stock" line under the product doesn't push it down. */}
        {/* For repairs the button sits after the device/warranty details instead, so it's pressed once everything is filled in. */}
        {!isService && (
          <Field label={<span className="invisible">Add</span>} className="col-span-2 md:col-span-1">
            <Button onClick={add} className="w-full" icon={<Plus className="h-4 w-4" />} aria-label="Add item">
              <span className="md:hidden">Add item</span>
            </Button>
          </Field>
        )}
      </div>

      {p?.trackSerial && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-medium text-slate-600">IMEI / Serial numbers</div>
          <SerialPicker productId={p._id} value={serials} max={Number(qty) || undefined} onChange={setSerials} />
        </div>
      )}

      {isService && (
        <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <Field label="IMEI / serial (customer device)">
            <Input value={imei} onChange={(e) => setImei(e.target.value)} />
          </Field>
          <Field label="Complaint / issue" className="sm:col-span-2">
            <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="e.g. Display cracked, touch not working" />
          </Field>
          <Field label="Spare used" hint={spare?.data ? `In stock: ${formatNumber(spare.data.stockQty)}` : 'Deducted from stock; cost goes to repair costs'}>
            <SearchSelect value={spare} onChange={setSpare} queryKey={[...qk.products, 'spares']} fetchOptions={fetchProducts('SPARE_PART,CONSUMABLE')} onAddNew={(t) => setNested({ kind: 'spare', text: t })} addLabel="Add spare part" />
          </Field>
          <Field label="Spare qty">
            <Input type="number" min={0} step="any" value={spareQty} onChange={(e) => setSpareQty(e.target.value)} disabled={!spare} />
          </Field>
          <Field label="Spare dealer / supplier" className="sm:col-span-2">
            <SearchSelect value={dealer} onChange={setDealer} queryKey={qk.vendors} fetchOptions={fetchVendors} onAddNew={(t) => setNested({ kind: 'dealer', text: t })} addLabel="Add dealer" disabled={!spare} />
          </Field>
          <Field label="Warranty status">
            <Select value={warranty} onChange={(e) => setWarranty(e.target.value as WarrantyStatus)}>
              <option value="NONE">No warranty</option>
              <option value="NEW_WARRANTY">New warranty on this service</option>
              <option value="IN_WARRANTY">Under existing warranty</option>
              <option value="OUT_OF_WARRANTY">Out of warranty</option>
            </Select>
          </Field>
          {warranty !== 'NONE' && (
            <>
              <Field label="Warranty start">
                <Input type="date" value={wStart} onChange={(e) => setWStart(e.target.value)} />
              </Field>
              <Field label="Warranty expiry">
                <Input type="date" value={wEnd} min={wStart || undefined} onChange={(e) => setWEnd(e.target.value)} />
              </Field>
            </>
          )}
          <Field label={<span className="invisible">Add</span>}>
            <Button onClick={add} className="w-full sm:w-auto sm:px-8" icon={<Plus className="h-4 w-4" />} aria-label="Add item">
              Add item
            </Button>
          </Field>
        </div>
      )}

      <ProductFormModal
        open={nested?.kind === 'product' || nested?.kind === 'spare'}
        initialName={nested?.text}
        defaultType={nested?.kind === 'spare' ? 'SPARE_PART' : nested?.kind === 'product' ? nested.type : 'ACCESSORY'}
        onClose={() => setNested(null)}
        onSaved={(prod) => (nested?.kind === 'spare' ? setSpare(productOption(prod)) : selectProduct(productOption(prod)))}
      />
      <MasterFormModal master="device-categories" label="Device category" open={nested?.kind === 'deviceCategory'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(m) => setDeviceCategory(masterOption(m))} />
      <MasterFormModal master="brands" label="Brand" open={nested?.kind === 'brand'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(m) => setBrand(masterOption(m))} />
      <DeviceModelFormModal open={nested?.kind === 'model'} initialName={nested?.text} brand={brand} deviceCategory={deviceCategory} onClose={() => setNested(null)} onSaved={(m) => setModel(masterOption(m))} />
      <VendorFormModal open={nested?.kind === 'dealer'} initialName={nested?.text} onClose={() => setNested(null)} onSaved={(v) => setDealer(vendorOption(v))} />
    </div>
  );
});
