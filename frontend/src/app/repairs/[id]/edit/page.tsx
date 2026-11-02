'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { ErrorState, Spinner } from '@/components/ui/Misc';
import { RepairForm } from '@/features/repairs/RepairForm';
import { qk } from '@/lib/queryKeys';
import { repairService } from '@/services';

export default function EditRepairPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({ queryKey: [...qk.repair(id), 'edit'], queryFn: () => repairService.get(id), staleTime: 0 });
  const locked = data && (data.sale || ['READY_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].includes(data.status));
  return (
    <AppShell permission="repairs.write">
      <PageHeader title={`Edit job ${data?.jobNo ?? ''}`} crumbs={[{ label: 'Repairs', href: '/repairs' }, { label: data?.jobNo ?? '…', href: `/repairs/${id}` }, { label: 'Edit' }]} />
      {isLoading ? <Spinner /> : error || !data ? <ErrorState error={error} /> : locked ? <ErrorState error={new Error('Completed, delivered or cancelled jobs cannot be edited.')} /> : <RepairForm repair={data} />}
    </AppShell>
  );
}
