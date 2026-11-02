'use client';

import { useQuery } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DataTable, ErrorState, SearchInput, StatCard } from '@/components/ui/Misc';
import { CustomerPaymentModal } from '@/features/payments/CustomerPaymentModal';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { add } from '@/lib/money';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatMoney } from '@/lib/utils';
import { customerService } from '@/services';
import type { Customer } from '@/types';

export default function CustomerCreditPage() {
  return (
    <AppShell permission="customers.read">
      <CustomerCredit />
    </AppShell>
  );
}

function CustomerCredit() {
  const router = useRouter();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [payFor, setPayFor] = useState<Customer | null | undefined>(undefined);
  const search = useDebounce(q, 300);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [...qk.customerCredit, search], queryFn: () => customerService.credit(search) });
  const receivable = data?.filter((r) => r.balance > 0) ?? [];
  const advances = data?.filter((r) => r.balance < 0) ?? [];

  return (
    <>
      <PageHeader
        title="Customer Credit"
        crumbs={[{ label: 'Customer Credit' }]}
        subtitle="Unpaid and partly paid invoices. Collect payments and allocate them to invoices."
        actions={
          can('customerPayments.create') && (
            <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setPayFor(null)}>
              Pay customer credit
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total receivable" value={formatMoney(add(...receivable.map((r) => r.balance)))} tone="amber" loading={isLoading} />
        <StatCard label="Overdue" value={formatMoney(add(...receivable.map((r) => r.overdue)))} tone="red" loading={isLoading} />
        <StatCard label="Customers with dues" value={receivable.length} tone="indigo" loading={isLoading} />
        <StatCard label="Advances held" value={formatMoney(-add(...advances.map((r) => r.balance)))} tone="teal" loading={isLoading} />
      </div>
      <div className="card">
        <div className="border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search customer…" className="w-full sm:w-80" />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : (
          <DataTable
            loading={isLoading}
            rows={data}
            onRowClick={(r) => router.push(`/customers/${r._id}`)}
            empty={<p className="p-8 text-center text-sm text-slate-500">No outstanding customer credit. 🎉</p>}
            columns={[
              { key: 'name', header: 'Customer', cell: (r) => (<div><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{r.mobile}</div></div>) },
              { key: 'sales', header: 'Total purchases', align: 'right', cell: (r) => formatMoney(r.totalSales) },
              { key: 'paid', header: 'Total paid', align: 'right', cell: (r) => formatMoney(r.totalPaid) },
              { key: 'open', header: 'Open invoices', align: 'right', cell: (r) => r.openInvoices },
              { key: 'oldest', header: 'Oldest invoice', cell: (r) => formatDate(r.oldestInvoiceDate) },
              { key: 'over', header: 'Overdue', align: 'right', cell: (r) => <span className={r.overdue > 0 ? 'font-medium text-red-600' : ''}>{formatMoney(r.overdue)}</span> },
              { key: 'bal', header: 'Outstanding', align: 'right', cell: (r) => <span className={r.balance > 0 ? 'font-semibold text-amber-700' : 'text-teal-700'}>{r.balance < 0 ? `Advance ${formatMoney(-r.balance)}` : formatMoney(r.balance)}</span> },
              {
                key: 'act',
                header: '',
                cell: (r) =>
                  r.balance > 0 && can('customerPayments.create') ? (
                    <Button
                      size="sm"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setPayFor(await customerService.get(r._id));
                      }}
                    >
                      Collect
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </div>
      <CustomerPaymentModal open={payFor !== undefined} onClose={() => setPayFor(undefined)} customer={payFor ?? undefined} />
    </>
  );
}
