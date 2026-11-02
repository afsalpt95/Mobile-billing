'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Spinner } from '@/components/ui/Misc';
import { Modal } from '@/components/ui/Modal';
import { SearchInput } from '@/components/ui/Misc';
import { useDebounce } from '@/hooks/useCommon';
import { formatDate, titleCase } from '@/lib/utils';
import { repairService } from '@/services';

/** Warranty claim lookup by IMEI, invoice no, job no or mobile number. */
export function WarrantyLookupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = useDebounce(q.trim(), 400);
  const { data, isFetching } = useQuery({ queryKey: ['warranty', term], queryFn: () => repairService.warrantyLookup(term), enabled: open && term.length >= 3 });
  const now = new Date();
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Warranty lookup" description="Search by IMEI / serial, invoice no, job no or customer mobile.">
      <SearchInput value={q} onChange={setQ} placeholder="Type at least 3 characters…" autoFocus />
      {isFetching && <Spinner />}
      {data && (
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <h3 className="mb-1 font-semibold">Sold items</h3>
            {!data.sales.length && <p className="text-slate-500">No invoices found.</p>}
            <ul className="divide-y divide-slate-100">
              {data.sales.flatMap((s) =>
                s.items
                  .filter((i) => i.warranty?.expiryDate || i.serials?.length)
                  .map((i, k) => {
                    const active = i.warranty?.expiryDate && new Date(i.warranty.expiryDate) >= now && (i.returnedQty ?? 0) < i.qty;
                    return (
                      <li key={`${s._id}-${k}`} className="flex items-center justify-between gap-2 py-2">
                        <div>
                          <div className="font-medium">{i.name}</div>
                          <div className="text-xs text-slate-500">
                            <Link className="text-brand-700 hover:underline" href={`/sales/${s._id}`} onClick={onClose}>
                              {s.invoiceNo}
                            </Link>{' '}
                            · {s.customerName} · {formatDate(s.date)} {i.serials?.length ? `· ${i.serials.join(', ')}` : ''}
                          </div>
                        </div>
                        {i.warranty?.expiryDate ? <Badge tone={active ? 'green' : 'gray'}>{active ? `Valid till ${formatDate(i.warranty.expiryDate)}` : `Expired ${formatDate(i.warranty.expiryDate)}`}</Badge> : <Badge>No warranty</Badge>}
                      </li>
                    );
                  }),
              )}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Repairs</h3>
            {!data.repairs.length && <p className="text-slate-500">No repair jobs found.</p>}
            <ul className="divide-y divide-slate-100">
              {data.repairs.map((r) => {
                const active = r.warrantyExpiry && new Date(r.warrantyExpiry) >= now;
                return (
                  <li key={r._id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <Link className="font-medium text-brand-700 hover:underline" href={`/repairs/${r._id}`} onClick={onClose}>
                        {r.jobNo}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {r.customerName} · {[r.brandName, r.deviceModelName].filter(Boolean).join(' ')} · {titleCase(r.status)}
                      </div>
                    </div>
                    {r.warrantyExpiry ? <Badge tone={active ? 'green' : 'gray'}>{active ? `${titleCase(r.warrantyType)} till ${formatDate(r.warrantyExpiry)}` : `Expired ${formatDate(r.warrantyExpiry)}`}</Badge> : <Badge>No warranty</Badge>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}
