'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Info, Printer } from 'lucide-react';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Card, DataTable, ErrorState, Spinner, StatCard } from '@/components/ui/Misc';
import { GroupedBars, HBars, Lines } from '@/features/reports/charts';
import { useSettings } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { cn, downloadCsv, formatDate, formatMoney } from '@/lib/utils';
import { reportService } from '@/services';

export default function ProfitLossPage() {
  return (
    <AppShell permission="reports.financial">
      <ProfitLoss />
    </AppShell>
  );
}

function ProfitLoss() {
  const [range, setRange] = useState(initialRange('month'));
  const { data: settings } = useSettings();
  const { data: pl, isLoading, error, refetch } = useQuery({ queryKey: [...qk.reports, 'pl', range.from, range.to], queryFn: () => reportService.profitLoss(range.from, range.to) });

  const statement: Array<{ label: string; value: number; kind?: 'sub' | 'total' | 'neg' | 'grand'; note?: string }> = pl
    ? [
        { label: 'Product sales revenue', value: pl.productSalesRevenue },
        { label: 'Spare-part revenue (repairs)', value: pl.sparePartRevenue },
        { label: 'Repair labour revenue', value: pl.repairLaborRevenue },
        { label: 'Gross revenue', value: pl.grossRevenue, kind: 'sub' },
        { label: 'Less: sales returns & refunds', value: -pl.salesReturns, kind: 'neg' },
        { label: 'Net revenue', value: pl.netRevenue, kind: 'total' },
        { label: 'Cost of goods sold', value: -pl.costOfGoodsSold, kind: 'neg', note: 'Weighted-average cost of products sold, net of returns' },
        { label: 'Spare-part cost consumed in repairs', value: -pl.repairPartsCost, kind: 'neg' },
        { label: 'Inventory write-offs & adjustments', value: -pl.inventoryWriteOffs, kind: 'neg', note: 'Damaged/lost stock, damaged returns, vendor-return losses, less stock found' },
        { label: 'Gross profit', value: pl.grossProfit, kind: 'total' },
        { label: 'Operating expenses', value: -pl.operatingExpenses, kind: 'neg' },
        { label: 'Net operating profit', value: pl.netOperatingProfit, kind: 'total' },
        { label: 'Other income', value: pl.otherIncome, note: 'Not tracked separately in this version' },
        { label: 'Other expenses', value: -pl.otherExpenses, kind: 'neg' },
        { label: 'Net profit', value: pl.netProfit, kind: 'grand' },
      ]
    : [];

  const exportCsv = () => {
    if (!pl) return;
    downloadCsv(`profit-loss-${range.from}-to-${range.to}.csv`, [
      ...statement.map((s) => ({ section: 'Statement', item: s.label, amount: s.value })),
      { section: 'Info', item: `${settings?.tax?.name ?? 'Tax'} collected (excluded from revenue)`, amount: pl.taxCollected },
      ...pl.expenseBreakdown.map((e: any) => ({ section: 'Expenses', item: e.category, amount: e.amount })),
      ...pl.byCategory.map((c: any) => ({ section: 'Sales by category', item: c.name, amount: c.revenue, cost: c.cost, profit: c.profit })),
      ...pl.series.map((d: any) => ({ section: 'Daily', item: d.date, amount: d.revenue, cost: d.cost, expenses: d.expenses, grossProfit: d.grossProfit, netProfit: d.netProfit })),
    ]);
  };

  return (
    <>
      <PageHeader
        title="Profit & Loss"
        crumbs={[{ label: 'Reports' }, { label: 'Profit & Loss' }]}
        actions={
          <>
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={!pl}>
              Export CSV
            </Button>
            <Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!pl}>
              Print
            </Button>
          </>
        }
      />
      <div className="no-print mb-4">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <div className="mb-4 hidden text-sm print:block">
        <b>{settings?.shopName}</b> — Profit &amp; Loss {formatDate(range.from)} to {formatDate(range.to)}
      </div>
      {isLoading ? (
        <Spinner />
      ) : error || !pl ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Net revenue" value={formatMoney(pl.netRevenue)} tone="indigo" sub={`Returns ${formatMoney(pl.salesReturns)}`} />
            <StatCard label="Direct costs" value={formatMoney(pl.directCosts)} tone="amber" sub="COGS + repair parts + write-offs" />
            <StatCard label="Gross profit" value={formatMoney(pl.grossProfit)} tone="green" sub={`Margin ${pl.grossMarginPct}%`} />
            <StatCard label="Operating expenses" value={formatMoney(pl.operatingExpenses)} tone="red" />
            <StatCard label="Net profit" value={<span className={pl.netProfit < 0 ? 'text-red-600' : ''}>{formatMoney(pl.netProfit)}</span>} tone={pl.netProfit < 0 ? 'red' : 'green'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Card title="Statement" bodyClassName="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {statement.map((s) => (
                    <tr key={s.label} className={cn('border-b border-slate-100', s.kind === 'total' && 'bg-slate-50 font-semibold', s.kind === 'grand' && 'bg-brand-50 text-base font-bold', s.kind === 'sub' && 'font-medium')}>
                      <td className={cn('px-4 py-2', !s.kind && 'pl-6', s.kind === 'neg' && 'pl-6 text-slate-600')}>
                        {s.label}
                        {s.note && <div className="text-xs font-normal text-slate-400">{s.note}</div>}
                      </td>
                      <td className={cn('px-4 py-2 text-right tabular-nums', s.value < 0 && 'text-red-600')}>{s.value < 0 ? `(${formatMoney(-s.value)})` : formatMoney(s.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2 p-4 text-xs text-slate-500">
                <Info className="h-4 w-4 shrink-0" />
                <p>
                  Accrual-basis management report. Revenue excludes {settings?.tax?.name ?? 'tax'} collected ({formatMoney(pl.taxCollected)}) and cancelled invoices. Cost uses the
                  weighted-average inventory cost recorded at the time of sale. Purchases and vendor payments are not expenses — stock reaches the P&amp;L only as cost of goods
                  when sold, so paying vendor credit never double-counts. Expenses are recognised on the expense date, paid or unpaid.
                </p>
              </div>
            </Card>
            <div className="space-y-4">
              <Card title="Revenue vs costs & expenses (daily)">
                <GroupedBars
                  data={pl.series}
                  xKey="date"
                  series={[
                    { key: 'revenue', label: 'Net revenue' },
                    { key: 'cost', label: 'Cost of sales' },
                    { key: 'expenses', label: 'Expenses' },
                  ]}
                />
              </Card>
              <Card title="Gross profit and net profit (daily)">
                <Lines
                  data={pl.series}
                  xKey="date"
                  series={[
                    { key: 'grossProfit', label: 'Gross profit' },
                    { key: 'netProfit', label: 'Net profit' },
                  ]}
                />
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Sales & profit by category" bodyClassName="p-0">
              {pl.byCategory.length > 0 && (
                <div className="p-4">
                  <HBars data={pl.byCategory.slice(0, 8)} labelKey="name" valueKey="revenue" />
                </div>
              )}
              <DataTable
                rows={pl.byCategory}
                empty={<p className="p-6 text-center text-sm text-slate-500">No sales in this period.</p>}
                columns={[
                  { key: 'n', header: 'Category', cell: (r: any) => r.name },
                  { key: 'q', header: 'Qty', align: 'right', cell: (r: any) => r.qty },
                  { key: 'r', header: 'Revenue', align: 'right', cell: (r: any) => formatMoney(r.revenue) },
                  { key: 'c', header: 'Cost', align: 'right', cell: (r: any) => formatMoney(r.cost) },
                  { key: 'p', header: 'Profit', align: 'right', cell: (r: any) => <span className={r.profit < 0 ? 'text-red-600' : 'font-medium'}>{formatMoney(r.profit)}</span> },
                ]}
              />
              <p className="px-4 pb-3 text-xs text-slate-400">Gross of returns.</p>
            </Card>
            <div className="space-y-4">
              <Card title="Expense breakdown" bodyClassName="p-0">
                <DataTable
                  rows={pl.expenseBreakdown}
                  empty={<p className="p-6 text-center text-sm text-slate-500">No expenses in this period.</p>}
                  columns={[
                    { key: 'c', header: 'Category', cell: (r: any) => r.category },
                    { key: 'k', header: 'Group', cell: (r: any) => (r.kind === 'OTHER' ? 'Other' : 'Operating') },
                    { key: 'a', header: 'Amount', align: 'right', cell: (r: any) => formatMoney(r.amount) },
                    { key: 's', header: 'Share', align: 'right', cell: (r: any) => `${(((r.amount || 0) / (pl.operatingExpenses + pl.otherExpenses || 1)) * 100).toFixed(1)}%` },
                  ]}
                />
              </Card>
              <Card title="Profit by product (top 20 by revenue)" bodyClassName="p-0">
                <DataTable
                  rows={pl.byProduct}
                  columns={[
                    { key: 'n', header: 'Item', cell: (r: any) => r.name },
                    { key: 'q', header: 'Qty', align: 'right', cell: (r: any) => r.qty },
                    { key: 'r', header: 'Revenue', align: 'right', cell: (r: any) => formatMoney(r.revenue) },
                    { key: 'p', header: 'Profit', align: 'right', cell: (r: any) => <span className={r.profit < 0 ? 'text-red-600' : ''}>{formatMoney(r.profit)}</span> },
                  ]}
                />
              </Card>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
