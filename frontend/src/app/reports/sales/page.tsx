'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Card, DataTable, ErrorState, Spinner, StatCard } from '@/components/ui/Misc';
import { GroupedBars, HBars } from '@/features/reports/charts';
import { qk } from '@/lib/queryKeys';
import { downloadCsv, formatMoney } from '@/lib/utils';
import { reportService } from '@/services';

export default function SalesReportPage() {
  return (
    <AppShell permission="reports.sales">
      <SalesReport />
    </AppShell>
  );
}

function SalesReport() {
  const [range, setRange] = useState(initialRange('month'));
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: [...qk.reports, 'sales', range.from, range.to], queryFn: () => reportService.sales(range.from, range.to) });
  const s = r?.summary;
  return (
    <>
      <PageHeader
        title="Sales Reports"
        crumbs={[{ label: 'Reports' }, { label: 'Sales' }]}
        actions={
          <>
            <Link href="/sales">
              <Button variant="outline">Invoice list</Button>
            </Link>
            <Button
              variant="outline"
              icon={<Download className="h-4 w-4" />}
              disabled={!r}
              onClick={() =>
                downloadCsv(`sales-${range.from}-to-${range.to}.csv`, [
                  ...r.daily.map((d: any) => ({ section: 'Daily', name: d.date, count: d.count, amount: d.total })),
                  ...r.byCategory.map((d: any) => ({ section: 'Category', name: d.name, count: d.qty, amount: d.total })),
                  ...r.topProducts.map((d: any) => ({ section: 'Top items', name: d.name, count: d.qty, amount: d.total })),
                  ...r.paymentMethods.map((d: any) => ({ section: 'Payment method (net)', name: d.method, count: '', amount: d.net })),
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
            <StatCard label="Invoices" value={s.invoices} tone="indigo" sub={`${s.cancelledCount} cancelled`} />
            <StatCard label="Gross sales" value={formatMoney(s.total)} tone="blue" sub={`Discounts ${formatMoney(s.discount)}`} />
            <StatCard label="Returns" value={formatMoney(s.returnsTotal)} tone="red" sub={`${s.returnsCount} returns`} />
            <StatCard label="Net sales" value={formatMoney(s.netSales)} tone="green" sub={`Tax ${formatMoney(s.tax)}`} />
            <StatCard label="Outstanding on these invoices" value={formatMoney(s.outstanding)} tone="amber" />
          </div>
          <Card title="Daily sales">
            <GroupedBars data={r.daily} xKey="date" series={[{ key: 'total', label: 'Sales' }]} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Sales by category" bodyClassName="p-0">
              {r.byCategory.length > 0 && (
                <div className="p-4">
                  <HBars data={r.byCategory.slice(0, 8)} labelKey="name" valueKey="total" />
                </div>
              )}
              <DataTable rows={r.byCategory} columns={[{ key: 'n', header: 'Category', cell: (x: any) => x.name }, { key: 'q', header: 'Qty', align: 'right', cell: (x: any) => x.qty }, { key: 't', header: 'Amount', align: 'right', cell: (x: any) => formatMoney(x.total) }]} />
            </Card>
            <div className="space-y-4">
              <Card title="Collections by payment method" bodyClassName="p-0">
                <DataTable
                  rows={r.paymentMethods}
                  empty={<p className="p-6 text-center text-sm text-slate-500">No payments.</p>}
                  columns={[
                    { key: 'm', header: 'Method', cell: (x: any) => x.method },
                    { key: 'r', header: 'Received', align: 'right', cell: (x: any) => formatMoney(x.received) },
                    { key: 'f', header: 'Refunded', align: 'right', cell: (x: any) => formatMoney(x.refunded) },
                    { key: 'n', header: 'Net', align: 'right', cell: (x: any) => <b>{formatMoney(x.net)}</b> },
                  ]}
                />
                <p className="px-4 pb-3 text-xs text-slate-400">Includes counter payments, credit collections and repair advances received in the period.</p>
              </Card>
              <Card title="Sales by user" bodyClassName="p-0">
                <DataTable rows={r.byUser} columns={[{ key: 'n', header: 'User', cell: (x: any) => x.name }, { key: 'c', header: 'Invoices', align: 'right', cell: (x: any) => x.count }, { key: 't', header: 'Amount', align: 'right', cell: (x: any) => formatMoney(x.total) }]} />
              </Card>
            </div>
          </div>
          <Card title="Top selling items" bodyClassName="p-0">
            <DataTable rows={r.topProducts} columns={[{ key: 'n', header: 'Item', cell: (x: any) => x.name }, { key: 'q', header: 'Qty', align: 'right', cell: (x: any) => x.qty }, { key: 't', header: 'Amount', align: 'right', cell: (x: any) => formatMoney(x.total) }]} />
          </Card>
        </div>
      )}
    </>
  );
}
