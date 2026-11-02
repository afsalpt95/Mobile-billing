'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Card, DataTable, ErrorState, Spinner, StatCard } from '@/components/ui/Misc';
import { GroupedBars } from '@/features/reports/charts';
import { qk } from '@/lib/queryKeys';
import { downloadCsv, formatMoney } from '@/lib/utils';
import { reportService } from '@/services';

export default function PurchaseReportPage() {
  return (
    <AppShell permission="reports.financial">
      <PurchaseReport />
    </AppShell>
  );
}

function PurchaseReport() {
  const router = useRouter();
  const [range, setRange] = useState(initialRange('month'));
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: [...qk.reports, 'purchases', range.from, range.to], queryFn: () => reportService.purchases(range.from, range.to) });
  const s = r?.summary;
  return (
    <>
      <PageHeader
        title="Purchase Reports"
        crumbs={[{ label: 'Reports' }, { label: 'Purchases' }]}
        actions={
          <>
            <Button
              variant="outline"
              icon={<Download className="h-4 w-4" />}
              disabled={!r}
              onClick={() =>
                downloadCsv(`purchases-${range.from}-to-${range.to}.csv`, [
                  ...r.byVendor.map((v: any) => ({ section: 'Vendor', name: v.name, count: v.count, amount: v.total, outstanding: v.due })),
                  ...r.topItems.map((v: any) => ({ section: 'Item', name: v.name, count: v.qty, amount: v.total, outstanding: '' })),
                  ...r.daily.map((v: any) => ({ section: 'Daily', name: v.date, count: v.count, amount: v.total, outstanding: '' })),
                ])
              }
            >
              Export CSV
            </Button>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />
      <div className="no-print mb-4">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      {isLoading ? (
        <Spinner />
      ) : error || !r ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Received purchases" value={s.purchases} tone="indigo" />
            <StatCard label="Purchase value" value={formatMoney(s.total)} tone="blue" sub={`Tax ${formatMoney(s.tax)} · charges ${formatMoney(s.charges)}`} />
            <StatCard label="Paid" value={formatMoney(s.paid)} tone="green" />
            <StatCard label="Outstanding" value={formatMoney(s.outstanding)} tone="amber" />
            <StatCard label="Vendor returns" value={formatMoney(s.returnsTotal)} tone="red" sub={`${s.returnsCount} returns`} />
          </div>
          <Card title="Daily purchases">
            <GroupedBars data={r.daily} xKey="date" series={[{ key: 'total', label: 'Purchases' }]} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="By vendor" bodyClassName="p-0">
              <DataTable
                rows={r.byVendor}
                onRowClick={(v: any) => router.push(`/vendors/${v.vendorId}`)}
                columns={[
                  { key: 'n', header: 'Vendor', cell: (v: any) => v.name },
                  { key: 'c', header: 'Purchases', align: 'right', cell: (v: any) => v.count },
                  { key: 't', header: 'Value', align: 'right', cell: (v: any) => formatMoney(v.total) },
                  { key: 'd', header: 'Outstanding', align: 'right', cell: (v: any) => formatMoney(v.due) },
                ]}
              />
            </Card>
            <Card title="Top purchased items" bodyClassName="p-0">
              <DataTable rows={r.topItems} columns={[{ key: 'n', header: 'Item', cell: (v: any) => v.name }, { key: 'q', header: 'Units', align: 'right', cell: (v: any) => v.qty }, { key: 't', header: 'Value (ex. tax)', align: 'right', cell: (v: any) => formatMoney(v.total) }]} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
