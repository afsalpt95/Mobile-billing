'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CreditCard,
  FileBarChart,
  HandCoins,
  Landmark,
  PackagePlus,
  Receipt,
  RotateCcw,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { StatCard } from '@/components/ui/Misc';
import { useAuth } from '@/hooks/useAuth';
import { qk } from '@/lib/queryKeys';
import { cn, formatMoney } from '@/lib/utils';
import { reportService } from '@/services';

const modules = [
  { href: '/billing', label: 'Billing / New Sale', desc: 'Quick POS billing & invoices', icon: ShoppingCart, color: 'from-brand-500 to-brand-700', perm: 'sales.create', key: 'F2' },
  { href: '/repairs', label: 'Repair Service', desc: 'Job cards, status & warranty', icon: Wrench, color: 'from-teal-500 to-teal-700', perm: 'repairs.read' },
  { href: '/purchases', label: 'Purchase', desc: 'Receive stock from vendors', icon: PackagePlus, color: 'from-sky-500 to-sky-700', perm: 'purchases.read' },
  { href: '/inventory', label: 'Inventory / Stock', desc: 'Products, stock & movements', icon: Boxes, color: 'from-violet-500 to-violet-700', perm: 'inventory.read' },
  { href: '/customers', label: 'Customers', desc: 'Profiles, history & ledger', icon: Users, color: 'from-blue-500 to-blue-700', perm: 'customers.read' },
  { href: '/vendors', label: 'Vendors', desc: 'Suppliers & statements', icon: Truck, color: 'from-cyan-500 to-cyan-700', perm: 'vendors.read' },
  { href: '/vendor-payments', label: 'Vendor Payments', desc: 'Payables & pay vendor credit', icon: Landmark, color: 'from-indigo-500 to-indigo-700', perm: 'vendorPayments.read' },
  { href: '/customer-credit', label: 'Customer Credit', desc: 'Dues & collect payments', icon: HandCoins, color: 'from-amber-500 to-amber-700', perm: 'customers.read' },
  { href: '/expenses', label: 'Expenses', desc: 'Shop expenses & payables', icon: Wallet, color: 'from-rose-500 to-rose-700', perm: 'expenses.read' },
  { href: '/reports/profit-loss', label: 'Profit & Loss', desc: 'Revenue, costs & net profit', icon: TrendingUp, color: 'from-emerald-500 to-emerald-700', perm: 'reports.financial' },
  { href: '/reports/sales', label: 'Sales Reports', desc: 'Sales by day, item & method', icon: BarChart3, color: 'from-fuchsia-500 to-fuchsia-700', perm: 'reports.sales' },
  { href: '/reports/purchases', label: 'Purchase Reports', desc: 'Purchases by vendor & item', icon: FileBarChart, color: 'from-orange-500 to-orange-700', perm: 'reports.financial' },
  { href: '/returns', label: 'Returns & Refunds', desc: 'Customer & vendor returns', icon: RotateCcw, color: 'from-red-500 to-red-700', perm: 'sales.read' },
  { href: '/settings', label: 'Settings', desc: 'Shop, tax, masters & users', icon: Settings, color: 'from-slate-500 to-slate-700', perm: 'settings.read' },
];

export default function HomePage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { can, user } = useAuth();
  const { data: s, isLoading } = useQuery({ queryKey: [...qk.dashboard, 'summary'], queryFn: reportService.dashboard, refetchInterval: 60_000 });
  const financial = can('reports.financial');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Welcome back, {user?.name?.split(' ')[0]}</h1>
          <p className="text-sm text-slate-500">Today&apos;s figures are calculated live from posted transactions.</p>
        </div>
      </div>

      <section aria-label="Today's summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard loading={isLoading} label="Today's Sales" value={formatMoney(s?.todaySales)} sub={`${s?.todaySalesCount ?? 0} invoices`} icon={<Receipt className="h-5 w-5" />} tone="indigo" />
        <StatCard loading={isLoading} label="Today's Purchase" value={formatMoney(s?.todayPurchases)} sub={`${s?.todayPurchasesCount ?? 0} received`} icon={<PackagePlus className="h-5 w-5" />} tone="blue" />
        <StatCard loading={isLoading} label="Today's Expenses" value={formatMoney(s?.todayExpenses)} sub={`${s?.todayExpensesCount ?? 0} entries`} icon={<Wallet className="h-5 w-5" />} tone="red" />
        <StatCard
          loading={isLoading}
          label="Gross Profit (today)"
          value={financial ? formatMoney(s?.todayGrossProfit) : '••••'}
          sub={financial ? `Net after expenses ${formatMoney(s?.todayNetProfit)}` : 'Restricted'}
          icon={<TrendingUp className="h-5 w-5" />}
          tone="green"
        />
        <StatCard loading={isLoading} label="Customer Credit Due" value={formatMoney(s?.outstandingCustomerCredit)} sub={`${s?.customersWithCredit ?? 0} customers`} icon={<HandCoins className="h-5 w-5" />} tone="amber" />
        <StatCard loading={isLoading} label="Vendor Credit Payable" value={formatMoney(s?.outstandingVendorCredit)} sub={`${s?.vendorsWithCredit ?? 0} vendors`} icon={<CreditCard className="h-5 w-5" />} tone="purple" />
        <Link href="/inventory?lowStock=1" className="block rounded-xl focus-visible:ring-4 focus-visible:ring-brand-500/30">
          <StatCard loading={isLoading} label="Low Stock Items" value={s?.lowStockItems ?? 0} sub="At or below minimum" icon={<AlertTriangle className="h-5 w-5" />} tone={s?.lowStockItems ? 'red' : 'slate'} />
        </Link>
        <Link href="/repairs" className="block rounded-xl focus-visible:ring-4 focus-visible:ring-brand-500/30">
          <StatCard loading={isLoading} label="Pending Repair Jobs" value={s?.pendingRepairs ?? 0} sub="Not yet delivered" icon={<Wrench className="h-5 w-5" />} tone="teal" />
        </Link>
      </section>

      <section aria-label="Modules" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {modules.map((m) => {
          const allowed = can(m.perm);
          const Icon = m.icon;
          const body = (
            <>
              <div className={cn('flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md transition-transform group-hover:scale-105', m.color)}>
                <Icon className="h-7 w-7" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">{m.label}</div>
                <div className="mt-0.5 text-xs leading-snug text-slate-500">{m.desc}</div>
              </div>
            </>
          );
          const cls = 'group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-center shadow-sm transition-all';
          return allowed ? (
            <Link key={m.href} href={m.href} className={cn(cls, 'hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg focus-visible:ring-4 focus-visible:ring-brand-500/30')}>
              {body}
            </Link>
          ) : (
            <div key={m.href} aria-disabled className={cn(cls, 'cursor-not-allowed opacity-45')} title="Not available for your role">
              {body}
            </div>
          );
        })}
      </section>
    </div>
  );
}
