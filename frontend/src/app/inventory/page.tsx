'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Checkbox, Select } from '@/components/ui/Field';
import { Badge, Card, DataTable, ErrorState, Pagination, SearchInput, StatCard, StatusBadge, Tabs } from '@/components/ui/Misc';
import { AdjustmentModal } from '@/features/inventory/AdjustmentModal';
import { MovementsTab } from '@/features/inventory/MovementsTab';
import { ProductFormModal } from '@/features/masters/QuickCreate';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { downloadCsv, formatDateTime, formatMoney, formatNumber, listRange, titleCase } from '@/lib/utils';
import { inventoryService, productService } from '@/services';
import type { Product } from '@/types';

type Tab = 'stock' | 'movements' | 'adjustments' | 'valuation';

export default function InventoryPage() {
  return (
    <AppShell permission="inventory.read">
      <Inventory />
    </AppShell>
  );
}

function Inventory() {
  const [tab, setTab] = useState<Tab>('stock');
  const { can } = useAuth();
  const [add, setAdd] = useState(false);
  const [adjust, setAdjust] = useState(false);
  return (
    <>
      <PageHeader
        title="Inventory & Stock"
        crumbs={[{ label: 'Inventory' }]}
        actions={
          <>
            {can('inventory.adjust') && (
              <Button variant="outline" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAdjust(true)}>
                Stock adjustment
              </Button>
            )}
            {can('products.write') && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>
                Add product
              </Button>
            )}
          </>
        }
      />
      <div className="card">
        <Tabs<Tab>
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'stock', label: 'Current stock' },
            { value: 'movements', label: 'Stock movements' },
            { value: 'adjustments', label: 'Adjustments' },
            { value: 'valuation', label: 'Valuation & alerts' },
          ]}
        />
        {tab === 'stock' && <StockTab />}
        {tab === 'movements' && <MovementsTab />}
        {tab === 'adjustments' && <AdjustmentsTab />}
        {tab === 'valuation' && <ValuationTab />}
      </div>
      <ProductFormModal open={add} onClose={() => setAdd(false)} />
      <AdjustmentModal open={adjust} onClose={() => setAdjust(false)} />
    </>
  );
}

function StockTab() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [lowStock, setLowStock] = useState(false);
  const [inactive, setInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('name');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('lowStock')) setLowStock(true);
  }, []);
  const search = useDebounce(q, 300);
  const params = { q: search, type: type || undefined, lowStock: lowStock || undefined, active: inactive ? 'all' : undefined, page, limit: 30, sort };
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.products, 'stock', params], queryFn: () => productService.list(params), placeholderData: keepPreviousData });
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-3">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, SKU, barcode, code…" className="w-full sm:w-72" autoFocus />
        <Select className="h-9 w-auto py-1" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type">
          <option value="">All types</option>
          <option value="PHONE">Mobile phones</option>
          <option value="SPARE_PART">Spare parts</option>
          <option value="ACCESSORY">Accessories</option>
          <option value="CONSUMABLE">Repair consumables</option>
          <option value="SERVICE">Services</option>
          <option value="OTHER">Other</option>
        </Select>
        <Checkbox label="Low stock only" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }} />
        <Checkbox label="Include inactive" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <DataTable<Product>
          loading={isLoading}
          rows={data?.items}
          sort={sort}
          onSort={setSort}
          onRowClick={(p) => router.push(`/inventory/products/${p._id}`)}
          rowClassName={(p) => (p.isLowStock ? 'bg-red-50/40' : undefined)}
          columns={[
            { key: 'code', header: 'Code', cell: (p) => <span className="font-mono text-xs">{p.productCode}</span> },
            { key: 'name', header: 'Product', sortKey: 'name', cell: (p) => (<div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{[p.sku, p.barcode].filter(Boolean).join(' · ')}</div></div>) },
            { key: 'type', header: 'Type', cell: (p) => titleCase(p.productType) },
            { key: 'cat', header: 'Category / brand', cell: (p) => [p.category?.name, p.brand?.name, p.deviceModel?.name].filter(Boolean).join(' · ') || '—' },
            { key: 'stock', header: 'Stock', align: 'right', sortKey: 'stock', cell: (p) => (p.trackInventory ? <span className={p.isLowStock ? 'font-semibold text-red-600' : 'font-medium'}>{formatNumber(p.stockQty)} {p.unit}</span> : <Badge>Service</Badge>) },
            { key: 'min', header: 'Min', align: 'right', cell: (p) => (p.trackInventory ? formatNumber(p.minStock) : '—') },
            { key: 'cost', header: 'Avg cost', align: 'right', cell: (p) => (p.trackInventory ? formatMoney(p.avgCost) : '—') },
            { key: 'price', header: 'Selling price', align: 'right', sortKey: 'price', cell: (p) => formatMoney(p.sellingPrice) },
            { key: 'value', header: 'Stock value', align: 'right', cell: (p) => (p.trackInventory ? formatMoney(p.stockValue) : '—') },
            { key: 'flags', header: '', cell: (p) => (<div className="flex gap-1">{p.trackSerial && <Badge tone="purple">IMEI</Badge>}{p.damagedQty > 0 && <Badge tone="red">{p.damagedQty} damaged</Badge>}{!p.isActive && <StatusBadge status="CANCELLED" label="Inactive" />}</div>) },
          ]}
        />
      )}
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
    </>
  );
}

function AdjustmentsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: [...qk.inventory, 'adjustments', page], queryFn: () => inventoryService.adjustments({ page, limit: 30 }), placeholderData: keepPreviousData });
  return (
    <>
      <DataTable
        loading={isLoading}
        rows={data?.items}
        columns={[
          { key: 'no', header: 'No', cell: (a) => <span className="font-medium">{a.adjustmentNo}</span> },
          { key: 'date', header: 'Date', cell: (a) => formatDateTime(a.date) },
          { key: 'p', header: 'Product', cell: (a) => a.product?.name },
          { key: 't', header: 'Type', cell: (a) => titleCase(a.type) },
          { key: 'q', header: 'Qty', align: 'right', cell: (a) => formatNumber(a.qty) },
          { key: 'v', header: 'Value', align: 'right', cell: (a) => formatMoney(a.value) },
          { key: 'r', header: 'Reason', cell: (a) => a.reason },
          { key: 'by', header: 'By', cell: (a) => a.createdBy?.name ?? '—' },
        ]}
      />
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
    </>
  );
}

function ValuationTab() {
  const { data, isLoading } = useQuery({ queryKey: [...qk.inventory, 'valuation'], queryFn: inventoryService.valuation });
  const t = data?.totals;
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard loading={isLoading} label="Stock value (at cost)" value={formatMoney(t?.value)} tone="indigo" sub={`${t?.items ?? 0} items · ${formatNumber(t?.qty)} units`} />
        <StatCard loading={isLoading} label="Retail value" value={formatMoney(t?.retailValue)} tone="green" />
        <StatCard loading={isLoading} label="Low stock / out of stock" value={`${t?.lowStock ?? 0} / ${t?.outOfStock ?? 0}`} tone="red" />
        <StatCard loading={isLoading} label="Damaged stock" value={formatMoney(t?.damagedValue)} tone="amber" sub={`${formatNumber(t?.damagedQty)} units`} />
      </div>
      <p className="text-xs text-slate-500">Valuation uses the weighted-average cost of each item. Negative stock (oversold with admin override) is valued at zero.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="By category"
          bodyClassName="p-0"
          actions={
            <Button size="sm" variant="outline" disabled={!data?.byCategory?.length} onClick={() => downloadCsv('stock-valuation.csv', data.byCategory)}>
              Export CSV
            </Button>
          }
        >
          <DataTable
            loading={isLoading}
            rows={data?.byCategory}
            columns={[
              { key: 'n', header: 'Category', cell: (r: any) => r.name },
              { key: 'i', header: 'Items', align: 'right', cell: (r: any) => r.items },
              { key: 'q', header: 'Units', align: 'right', cell: (r: any) => formatNumber(r.qty) },
              { key: 'v', header: 'Cost value', align: 'right', cell: (r: any) => formatMoney(r.value) },
              { key: 'rv', header: 'Retail value', align: 'right', cell: (r: any) => formatMoney(r.retailValue) },
            ]}
          />
        </Card>
        <Card title="Low-stock alerts" bodyClassName="p-0">
          <DataTable
            loading={isLoading}
            rows={data?.lowStock}
            empty={<p className="p-6 text-center text-sm text-slate-500">All items are above their minimum level.</p>}
            columns={[
              { key: 'n', header: 'Product', cell: (p: any) => <Link className="font-medium hover:text-brand-700" href={`/inventory/products/${p._id}`}>{p.name}</Link> },
              { key: 's', header: 'Stock', align: 'right', cell: (p: any) => <span className="font-semibold text-red-600">{formatNumber(p.stockQty)}</span> },
              { key: 'm', header: 'Min', align: 'right', cell: (p: any) => formatNumber(p.minStock) },
              { key: 'v', header: 'Preferred vendor', cell: (p: any) => p.preferredVendor?.name ?? '—' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
