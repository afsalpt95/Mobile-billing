'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PrintFrame, ShopHeader } from '@/features/print/PrintFrame';
import { useSettings } from '@/hooks/useCommon';
import { formatDate, formatMoney, titleCase } from '@/lib/utils';
import { customerService, vendorService } from '@/services';

/** Customer or vendor account statement for a date range (?from=YYYY-MM-DD&to=YYYY-MM-DD). */
export default function StatementPage() {
  const { kind, id } = useParams<{ kind: 'customer' | 'vendor'; id: string }>();
  const { data: settings } = useSettings();
  const [range, setRange] = useState<{ from?: string; to?: string } | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setRange({ from: sp.get('from') || undefined, to: sp.get('to') || undefined });
  }, []);
  const party = useQuery<{ name: string; mobile?: string }>({ queryKey: [kind, id], queryFn: () => (kind === 'vendor' ? vendorService.get(id) : customerService.get(id)) });
  const ledger = useQuery({
    queryKey: [kind, id, 'statement', range],
    queryFn: () => (kind === 'vendor' ? vendorService.ledger(id, range ?? {}) : customerService.ledger(id, range ?? {})),
    enabled: !!range,
  });
  const l = ledger.data;
  const isVendor = kind === 'vendor';
  return (
    <PrintFrame loading={ledger.isLoading || party.isLoading} error={ledger.error ?? party.error ?? undefined} ready={!!l && !!party.data} title="Statement">
      {l && party.data && (
        <div>
          <ShopHeader settings={settings} docTitle={`${isVendor ? 'Vendor' : 'Customer'} Statement`} meta={[['Period', `${range?.from ? formatDate(range.from) : 'Beginning'} – ${range?.to ? formatDate(range.to) : 'Today'}`]]} />
          <div className="mt-3">
            <span className="font-semibold">{party.data.name}</span>
            {party.data.mobile && <span> · {party.data.mobile}</span>}
          </div>
          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-slate-400 bg-slate-50 text-left">
                <th className="px-1.5 py-1">Date</th>
                <th className="px-1.5 py-1">Type</th>
                <th className="px-1.5 py-1">Ref</th>
                <th className="px-1.5 py-1">Details</th>
                <th className="px-1.5 py-1 text-right">{isVendor ? 'Debit (paid / returned)' : 'Debit (billed)'}</th>
                <th className="px-1.5 py-1 text-right">{isVendor ? 'Credit (purchased)' : 'Credit (paid)'}</th>
                <th className="px-1.5 py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200 font-medium">
                <td className="px-1.5 py-1" colSpan={6}>
                  Opening balance
                </td>
                <td className="px-1.5 py-1 text-right">{formatMoney(l.opening)}</td>
              </tr>
              {l.entries.map((e) => (
                <tr key={e._id} className="border-b border-slate-200">
                  <td className="px-1.5 py-1 whitespace-nowrap">{formatDate(e.date)}</td>
                  <td className="px-1.5 py-1">{titleCase(e.type)}</td>
                  <td className="px-1.5 py-1">{e.refNo}</td>
                  <td className="px-1.5 py-1 text-slate-600">{e.narration}</td>
                  <td className="px-1.5 py-1 text-right">{e.debit ? formatMoney(e.debit) : ''}</td>
                  <td className="px-1.5 py-1 text-right">{e.credit ? formatMoney(e.credit) : ''}</td>
                  <td className="px-1.5 py-1 text-right">{formatMoney(e.runningBalance)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-400 font-bold">
                <td className="px-1.5 py-1" colSpan={4}>
                  Closing balance {isVendor ? (l.closing >= 0 ? '(payable)' : '(advance with vendor)') : l.closing >= 0 ? '(due from customer)' : '(advance held)'}
                </td>
                <td className="px-1.5 py-1 text-right">{formatMoney(l.totalDebit)}</td>
                <td className="px-1.5 py-1 text-right">{formatMoney(l.totalCredit)}</td>
                <td className="px-1.5 py-1 text-right">{formatMoney(l.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </PrintFrame>
  );
}
