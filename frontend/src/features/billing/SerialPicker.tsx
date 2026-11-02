'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { productService } from '@/services';

/** Pick IMEI / serial numbers for a serial-tracked product (from IN_STOCK serials, or a given list). */
export function SerialPicker({
  productId,
  value,
  onChange,
  max,
  status = 'IN_STOCK',
  options,
}: {
  productId: string;
  value: string[];
  onChange: (serials: string[]) => void;
  max?: number;
  status?: string;
  options?: string[];
}) {
  const [filter, setFilter] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [...qk.product(productId), 'serials', status],
    queryFn: () => productService.serials(productId, status),
    enabled: !options,
  });
  const all = options ?? data?.map((s) => s.serial) ?? [];
  const list = all.filter((s) => s.includes(filter.trim().toUpperCase()));
  const toggle = (s: string) => {
    if (value.includes(s)) onChange(value.filter((x) => x !== s));
    else if (!max || value.length < max) onChange([...value, s]);
  };
  return (
    <div className="space-y-2">
      <input className="input" placeholder="Scan or type IMEI to filter…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const exact = all.find((s) => s === filter.trim().toUpperCase());
          if (exact) {
            toggle(exact);
            setFilter('');
          }
        }
      }} />
      {isLoading && !options ? (
        <div className="text-xs text-slate-500">Loading serials…</div>
      ) : all.length === 0 ? (
        <div className="text-xs text-red-600">No IMEI / serial numbers in stock for this item.</div>
      ) : (
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {list.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => toggle(s)}
              className={cn('rounded-md border px-2 py-1 font-mono text-xs', value.includes(s) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="text-xs text-slate-500">
        Selected {value.length}
        {max ? ` / ${max}` : ''}
      </div>
    </div>
  );
}
