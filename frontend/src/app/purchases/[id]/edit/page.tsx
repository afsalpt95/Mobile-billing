'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { ErrorState, Spinner } from '@/components/ui/Misc';
import { PurchaseForm } from '@/features/purchases/PurchaseForm';
import { qk } from '@/lib/queryKeys';
import { productService, purchaseService } from '@/services';
import type { Product } from '@/types';

export default function EditPurchasePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: [...qk.purchase(id), 'edit'],
    queryFn: async () => {
      const p = await purchaseService.get(id);
      const products = await Promise.all([...new Set(p.items.map((i) => i.product))].map((pid) => productService.get(pid).catch(() => null)));
      return { ...p, productsById: Object.fromEntries(products.filter((x): x is Product => !!x).map((x) => [x._id, x])) };
    },
    staleTime: 0,
  });
  return (
    <AppShell permission="purchases.write">
      <PageHeader title={`Edit draft ${data?.purchaseNo ?? ''}`} crumbs={[{ label: 'Purchases', href: '/purchases' }, { label: data?.purchaseNo ?? '…', href: `/purchases/${id}` }, { label: 'Edit' }]} />
      {isLoading ? <Spinner /> : error || !data ? <ErrorState error={error} /> : data.status !== 'DRAFT' ? <ErrorState error={new Error('Only draft purchases can be edited. Cancel the received purchase and create a corrected copy.')} /> : <PurchaseForm initial={data} />}
    </AppShell>
  );
}
