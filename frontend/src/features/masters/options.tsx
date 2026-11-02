import type { Option } from '@/components/ui/SearchSelect';
import { formatMoney, formatNumber } from '@/lib/utils';
import { customerService, masterService, productService, vendorService, type MasterName } from '@/services';
import type { Customer, MasterItem, Product, Vendor } from '@/types';

export const customerOption = (c: Customer): Option<Customer> => ({
  value: c._id,
  label: c.name,
  sublabel: c.isWalkIn ? 'Cash sale without details' : c.mobile,
  right: c.balance > 0 ? <span className="text-amber-700">Due {formatMoney(c.balance)}</span> : undefined,
  data: c,
});

export async function fetchCustomers(q: string): Promise<Option<Customer>[]> {
  const res = await customerService.list({ q, limit: 15, includeWalkIn: true, sort: 'name' });
  return res.items.map(customerOption);
}

export const vendorOption = (v: Vendor): Option<Vendor> => ({
  value: v._id,
  label: v.name,
  sublabel: [v.contactPerson, v.mobile].filter(Boolean).join(' · ') || undefined,
  right: v.balance > 0 ? <span className="text-amber-700">Payable {formatMoney(v.balance)}</span> : undefined,
  data: v,
});

export async function fetchVendors(q: string): Promise<Option<Vendor>[]> {
  const res = await vendorService.list({ q, limit: 15 });
  return res.items.map(vendorOption);
}

export const masterOption = (m: MasterItem): Option<MasterItem> => ({
  value: m._id,
  label: m.name,
  sublabel: typeof m.brand === 'object' && m.brand ? m.brand.name : undefined,
  data: m,
});

export function fetchMaster(name: MasterName, extra?: Record<string, string | undefined>) {
  return async (q: string) => (await masterService.list(name, { q, limit: 50, ...extra })).map(masterOption);
}

export const productOption = (p: Product): Option<Product> => ({
  value: p._id,
  label: p.name,
  sublabel: [p.productCode, p.sku, p.brand?.name].filter(Boolean).join(' · '),
  right: p.trackInventory ? (
    <span className={p.stockQty <= 0 ? 'font-medium text-red-600' : p.isLowStock ? 'text-amber-700' : 'text-emerald-700'}>
      {formatNumber(p.stockQty)} {p.unit} · {formatMoney(p.sellingPrice)}
    </span>
  ) : (
    <span>Service · {formatMoney(p.sellingPrice)}</span>
  ),
  data: p,
});

export function fetchProducts(type?: string) {
  return async (q: string) => (await productService.list({ q, limit: 20, type, sort: 'name' })).items.map(productOption);
}
