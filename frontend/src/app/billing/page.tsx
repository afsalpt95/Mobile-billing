'use client';

import { AppShell } from '@/components/layout/AppShell';
import { BillingScreen } from '@/features/billing/BillingScreen';

export default function BillingPage() {
  return (
    <AppShell permission="sales.create">
      <BillingScreen />
    </AppShell>
  );
}
