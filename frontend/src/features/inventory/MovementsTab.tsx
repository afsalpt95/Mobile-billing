'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { DateRangeFilter, initialRange } from '@/components/ui/DateRange';
import { Select } from '@/components/ui/Field';
import { Badge, DataTable, Pagination, SearchInput } from '@/components/ui/Misc';
import { useDebounce } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, formatMoney, formatNumber, listRange, titleCase } from '@/lib/utils';
import { inventoryService } from '@/services';

const MOVEMENT_TYPES = ['OPENING', 'PURCHASE', 'PURCHASE_CANCEL', 'PURCHASE_RETURN', 'SALE', 'SALE_CANCEL', 'SALE_RETURN', 'SALE_RETURN_DAMAGED', 'REPAIR_CONSUMPTION', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED'];
const refLink = (refType: string, refId: string) =>
  ({ Sale: `/sales/${refId}`, Purchase: `/purchases/${refId}`, Product: `/inventory/products/${refId}` })[refType] as string | undefined;

export function MovementsTab({ productId }: { productId?: string }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [range, setRange] = useState(initialRange('month'));
  const [page, setPage] = useState(1);
  const search = useDebounce(q, 300);
  const params = { q: search, type: type || undefined, product: productId, ...(productId ? {} : listRange(range)), page, limit: 30 };
  const { data, isLoading } = useQuery({ queryKey: [...qk.inventory, 'movements', params], queryFn: () => inventoryService.movements(params), placeholderData: keepPreviousData });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        {!productId && <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Product, reference, IMEI…" className="w-full sm:w-64" />}
        <Select className="h-9 w-auto py-1" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Movement type">
          <option value="">All movement types</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
        {!productId && <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />}
      </div>
      <DataTable
        loading={isLoading}
        rows={data?.items}
        columns={[
          { key: 'date', header: 'Date', cell: (m) => formatDateTime(m.date) },
          ...(productId ? [] : [{ key: 'p', header: 'Product', cell: (m: any) => <Link className="font-medium hover:text-brand-700" href={`/inventory/products/${m.product}`}>{m.productName}</Link> }]),
          { key: 'type', header: 'Type', cell: (m) => <Badge tone={m.qty > 0 ? 'green' : m.qty < 0 ? 'red' : 'amber'}>{titleCase(m.type)}</Badge> },
          { key: 'qty', header: 'Qty', align: 'right', cell: (m) => <span className={m.qty > 0 ? 'text-emerald-700' : m.qty < 0 ? 'text-red-600' : ''}>{m.qty > 0 ? '+' : ''}{formatNumber(m.qty)}{m.damagedQty ? ` (dmg ${m.damagedQty > 0 ? '+' : ''}${m.damagedQty})` : ''}</span> },
          { key: 'cost', header: 'Unit cost', align: 'right', cell: (m) => formatMoney(m.unitCost) },
          { key: 'bal', header: 'Balance', align: 'right', cell: (m) => formatNumber(m.balanceAfter) },
          { key: 'ref', header: 'Reference', cell: (m) => { const href = refLink(m.refType, m.refId); return href ? <Link href={href} className="text-brand-700 hover:underline">{m.refNo}</Link> : <span>{m.refNo}</span>; } },
          { key: 'notes', header: 'Notes', cell: (m) => <span className="text-xs text-slate-500">{[m.serials?.join(', '), m.notes].filter(Boolean).join(' · ')}</span> },
          { key: 'by', header: 'By', cell: (m) => m.createdBy?.name ?? '—' },
        ]}
      />
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
    </>
  );
}
