'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Misc';
import { RepairForm } from '@/features/repairs/RepairForm';
import { customerService } from '@/services';

export default function NewRepairPage() {
  const [customerId, setCustomerId] = useState<string | null | undefined>(undefined);
  useEffect(() => setCustomerId(new URLSearchParams(window.location.search).get('customer')), []);
  const { data: customer, isLoading } = useQuery({ queryKey: ['customers', 'detail', customerId], queryFn: () => customerService.get(customerId!), enabled: !!customerId });
  return (
    <AppShell permission="repairs.write">
      <PageHeader title="New repair job" crumbs={[{ label: 'Repairs', href: '/repairs' }, { label: 'New job' }]} />
      {customerId === undefined || (customerId && isLoading) ? <Spinner /> : <RepairForm initialCustomer={customer} />}
    </AppShell>
  );
}
