'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Power, SlidersHorizontal } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Badge, Card, DataTable, ErrorState, Spinner, StatCard, StatusBadge, Tabs } from '@/components/ui/Misc';
import { AdjustmentModal } from '@/features/inventory/AdjustmentModal';
import { MovementsTab } from '@/features/inventory/MovementsTab';
import { ProductFormModal } from '@/features/masters/QuickCreate';
import { useAuth } from '@/hooks/useAuth';
import { useInvalidate } from '@/hooks/useCommon';
import { errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatMoney, formatNumber, titleCase } from '@/lib/utils';
import { productService } from '@/services';

export default function ProductDetailPage() {
  return (
    <AppShell permission="inventory.read">
      <ProductDetail />
    </AppShell>
  );
}

function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<'movements' | 'serials'>('movements');
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: qk.product(id), queryFn: () => productService.get(id) });
  const serials = useQuery({ queryKey: [...qk.product(id), 'serials', 'all'], queryFn: () => productService.serials(id), enabled: tab === 'serials' && !!p?.trackSerial });
  const toggle = useMutation({
    mutationFn: () => productService.update(id, { isActive: !p!.isActive }),
    onSuccess: async () => {
      toast.success('Product updated');
      await invalidate(qk.products);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <Spinner />;
  if (error || !p) return <ErrorState error={error} onRetry={refetch} />;
  const low = p.trackInventory && p.stockQty <= p.minStock;
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} {!p.isActive && <StatusBadge status="CANCELLED" label="Inactive" />} {p.trackSerial && <Badge tone="purple">IMEI tracked</Badge>}
          </span>
        }
        crumbs={[{ label: 'Inventory', href: '/inventory' }, { label: p.productCode }]}
        subtitle={[titleCase(p.productType), p.category?.name, p.brand?.name, p.deviceModel?.name, p.sku && `SKU ${p.sku}`, p.barcode && `Barcode ${p.barcode}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {can('products.write') && (
              <>
                <Button variant="outline" icon={<Power className="h-4 w-4" />} onClick={() => toggle.mutate()} loading={toggle.isPending}>
                  {p.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>
                  Edit
                </Button>
              </>
            )}
            {can('inventory.adjust') && p.trackInventory && !p.trackSerial && (
              <Button variant="outline" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAdjust(true)}>
                Adjust stock
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="In stock" value={p.trackInventory ? `${formatNumber(p.stockQty)} ${p.unit}` : 'Service'} tone={low ? 'red' : 'indigo'} sub={p.trackInventory ? `Minimum ${formatNumber(p.minStock)}` : undefined} />
        <StatCard label="Average cost" value={formatMoney(p.avgCost)} tone="slate" sub={`Last purchase ${formatMoney(p.purchaseCost)}`} />
        <StatCard label="Selling price" value={formatMoney(p.sellingPrice)} tone="green" sub={p.avgCost ? `Margin ${(((p.sellingPrice - p.avgCost) / (p.sellingPrice || 1)) * 100).toFixed(1)}%` : undefined} />
        <StatCard label="Stock value" value={formatMoney(Math.max(p.stockQty, 0) * p.avgCost)} tone="teal" />
        <StatCard label="Damaged" value={formatNumber(p.damagedQty)} tone={p.damagedQty ? 'amber' : 'slate'} sub={`Warranty ${p.warrantyMonths} months`} />
      </div>
      {p.description && <Card className="mb-4"><p className="text-sm text-slate-600">{p.description}</p></Card>}
      <div className="card">
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: 'movements', label: 'Stock movement history' }, ...(p.trackSerial ? [{ value: 'serials' as const, label: 'IMEI / serial numbers' }] : [])]} />
        {tab === 'movements' && <MovementsTab productId={id} />}
        {tab === 'serials' && (
          <DataTable
            loading={serials.isLoading}
            rows={serials.data}
            columns={[
              { key: 's', header: 'IMEI / serial', cell: (s) => <span className="font-mono">{s.serial}</span> },
              { key: 'st', header: 'Status', cell: (s) => <StatusBadge status={s.status === 'IN_STOCK' ? 'ACTIVE' : s.status} label={titleCase(s.status)} /> },
              { key: 'p', header: 'Purchase', cell: (s) => s.purchaseNo ?? '—' },
              { key: 'i', header: 'Invoice', cell: (s) => s.invoiceNo ?? '—' },
            ]}
          />
        )}
      </div>
      <ProductFormModal open={edit} onClose={() => setEdit(false)} product={p} onSaved={() => refetch()} />
      <AdjustmentModal open={adjust} onClose={() => setAdjust(false)} product={p} />
    </>
  );
}
