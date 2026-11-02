'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { RotateCcw, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Field } from '@/components/ui/Field';
import { DataTable, Pagination, SearchInput, StatusBadge, Tabs } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { PurchaseReturnModal, SalesReturnModal } from '@/features/returns/ReturnModals';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useCommon';
import { errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatMoney, listRange, titleCase } from '@/lib/utils';
import { purchaseService, returnService, saleService } from '@/services';
import type { Purchase, Sale } from '@/types';

export default function ReturnsPage() {
  return (
    <AppShell permission="sales.read">
      <Returns />
    </AppShell>
  );
}

function Returns() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'sales' | 'purchases'>('sales');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(initialRange('month'));
  const [page, setPage] = useState(1);
  const [pick, setPick] = useState<'sale' | 'purchase' | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const search = useDebounce(q, 300);
  const params = { q: search, ...listRange(range), page, limit: 25 };
  const list = useQuery({
    queryKey: [...qk.returns, tab, params],
    queryFn: () => (tab === 'sales' ? returnService.sales(params) : returnService.purchases(params)),
    placeholderData: keepPreviousData,
    enabled: tab === 'sales' || can('purchases.read'),
  });

  return (
    <>
      <PageHeader
        title="Returns & Refunds"
        crumbs={[{ label: 'Returns' }]}
        actions={
          <>
            {can('returns.sales') && (
              <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setPick('sale')}>
                Customer return
              </Button>
            )}
            {can('returns.purchases') && (
              <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => setPick('purchase')}>
                Return to vendor
              </Button>
            )}
          </>
        }
      />
      <div className="card">
        <Tabs
          className="px-3"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setPage(1);
          }}
          tabs={[{ value: 'sales', label: 'Customer returns' }, ...(can('purchases.read') ? [{ value: 'purchases' as const, label: 'Vendor returns' }] : [])]}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Return no, invoice / purchase no, name…" className="w-full sm:w-72" />
          <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        </div>
        {tab === 'sales' ? (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.items as any[]}
            columns={[
              { key: 'no', header: 'Return', cell: (r: any) => <span className="font-medium">{r.returnNo}</span> },
              { key: 'd', header: 'Date', cell: (r: any) => formatDate(r.date) },
              { key: 'inv', header: 'Invoice', cell: (r: any) => <Link className="text-brand-700 hover:underline" href={`/sales/${r.sale}`}>{r.invoiceNo}</Link> },
              { key: 'c', header: 'Customer', cell: (r: any) => r.customerName },
              { key: 'i', header: 'Items', cell: (r: any) => r.items.map((i: any) => `${i.name} × ${i.qty}${i.restock || i.itemType === 'SERVICE' ? '' : ' (damaged)'}`).join(', ') },
              { key: 'r', header: 'Reason', cell: (r: any) => r.reason },
              { key: 'v', header: 'Value', align: 'right', cell: (r: any) => formatMoney(r.totalAmount) },
              { key: 'ref', header: 'Refunded', align: 'right', cell: (r: any) => (r.refundAmount ? `${formatMoney(r.refundAmount)} (${r.refundMethod})` : '—') },
            ]}
          />
        ) : (
          <DataTable
            loading={list.isLoading}
            rows={list.data?.items as any[]}
            columns={[
              { key: 'no', header: 'Return', cell: (r: any) => <span className="font-medium">{r.returnNo}</span> },
              { key: 'd', header: 'Date', cell: (r: any) => formatDate(r.date) },
              { key: 'p', header: 'Purchase', cell: (r: any) => <Link className="text-brand-700 hover:underline" href={`/purchases/${r.purchase}`}>{r.purchaseNo}</Link> },
              { key: 'v', header: 'Vendor', cell: (r: any) => r.vendorName },
              { key: 'i', header: 'Items', cell: (r: any) => r.items.map((i: any) => `${i.name} × ${i.qty}`).join(', ') },
              { key: 's', header: 'Settlement', cell: (r: any) => <StatusBadge status={r.settlement === 'REFUND' ? 'REFUND_RECEIVED' : 'ADVANCE'} label={titleCase(r.settlement)} /> },
              { key: 'a', header: 'Credit value', align: 'right', cell: (r: any) => formatMoney(r.totalAmount) },
            ]}
          />
        )}
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </div>

      <PickDocumentModal
        kind={pick}
        onClose={() => setPick(null)}
        onPicked={async (id) => {
          try {
            if (pick === 'sale') setSale(await saleService.get(id));
            else setPurchase(await purchaseService.get(id));
            setPick(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
      {sale && <SalesReturnModal sale={sale} open={!!sale} onClose={() => setSale(null)} />}
      {purchase && <PurchaseReturnModal purchase={purchase} open={!!purchase} onClose={() => setPurchase(null)} />}
    </>
  );
}

function PickDocumentModal({ kind, onClose, onPicked }: { kind: 'sale' | 'purchase' | null; onClose: () => void; onPicked: (id: string) => void }) {
  const [value, setValue] = useState<Option | null>(null);
  return (
    <Modal open={!!kind} onClose={onClose} size="md" title={kind === 'sale' ? 'Find the original invoice' : 'Find the original purchase'} footer={<Button onClick={() => value && onPicked(value.value)} disabled={!value}>Continue</Button>}>
      <Field label={kind === 'sale' ? 'Invoice no, customer, mobile or IMEI' : 'Purchase no, vendor or vendor invoice'}>
        {kind === 'sale' ? (
          <SearchSelect
            value={value}
            onChange={setValue}
            queryKey={[...qk.sales, 'pick']}
            fetchOptions={async (q) =>
              (await saleService.list({ q, status: 'COMPLETED', limit: 15 })).items.map((s) => ({
                value: s._id,
                label: s.invoiceNo,
                sublabel: `${s.customerName} · ${formatDate(s.date)}`,
                right: formatMoney(s.grandTotal),
                disabled: s.returnStatus === 'FULL',
              }))
            }
          />
        ) : (
          <SearchSelect
            value={value}
            onChange={setValue}
            queryKey={[...qk.purchases, 'pick']}
            fetchOptions={async (q) =>
              (await purchaseService.list({ q, status: 'RECEIVED', limit: 15 })).items.map((p) => ({
                value: p._id,
                label: p.purchaseNo,
                sublabel: `${p.vendorName} · ${formatDate(p.date)}${p.vendorInvoiceNo ? ` · ${p.vendorInvoiceNo}` : ''}`,
                right: formatMoney(p.grandTotal),
                disabled: p.returnStatus === 'FULL',
              }))
            }
          />
        )}
      </Field>
    </Modal>
  );
}
