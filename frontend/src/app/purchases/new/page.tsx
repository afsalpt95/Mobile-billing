'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Misc';
import { PurchaseForm } from '@/features/purchases/PurchaseForm';
import { vendorService } from '@/services';

export default function NewPurchasePage() {
  const [vendorId, setVendorId] = useState<string | null | undefined>(undefined);
  useEffect(() => setVendorId(new URLSearchParams(window.location.search).get('vendor')), []);
  const { data: vendor, isLoading } = useQuery({ queryKey: ['vendors', 'detail', vendorId], queryFn: () => vendorService.get(vendorId!), enabled: !!vendorId });
  return (
    <AppShell permission="purchases.write">
      <PageHeader title="New purchase" crumbs={[{ label: 'Purchases', href: '/purchases' }, { label: 'New' }]} subtitle="Stock and the vendor payable are only posted when the purchase is received." />
      {vendorId === undefined || (vendorId && isLoading) ? <Spinner /> : <PurchaseForm initialVendor={vendor} />}
    </AppShell>
  );
}
