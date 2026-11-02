'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { EmptyState, Spinner } from '@/components/ui/Misc';
import { downloadCsv, formatDate, formatMoney, openPrint, titleCase } from '@/lib/utils';
import { customerService, vendorService } from '@/services';

/** Ledger / statement for a customer or vendor with a date range, print and CSV export. */
export function LedgerView({ kind, id }: { kind: 'customer' | 'vendor'; id: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: [kind === 'vendor' ? 'vendors' : 'customers', id, 'ledger', from, to],
    queryFn: () => (kind === 'vendor' ? vendorService.ledger(id, { from, to }) : customerService.ledger(id, { from, to })),
  });
  const vendor = kind === 'vendor';
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
        <label className="text-xs text-slate-600">
          From
          <Input type="date" className="h-9 py-1" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-slate-600">
          To
          <Input type="date" className="h-9 py-1" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.entries.length}
            onClick={() =>
              downloadCsv(`${kind}-statement.csv`, [
                { date: '', type: 'OPENING', ref: '', details: 'Opening balance', debit: '', credit: '', balance: data!.opening },
                ...data!.entries.map((e) => ({ date: formatDate(e.date), type: e.type, ref: e.refNo ?? '', details: e.narration ?? '', debit: e.debit || '', credit: e.credit || '', balance: e.runningBalance })),
              ])
            }
          >
            Export CSV
          </Button>
          <Button variant="outline" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => openPrint(`/print/statement/${kind}/${id}?from=${from}&to=${to}`)}>
            Print statement
          </Button>
        </div>
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data ? null : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Details</th>
                <th className="text-right">{vendor ? 'Debit (paid/returned)' : 'Debit (billed)'}</th>
                <th className="text-right">{vendor ? 'Credit (purchased)' : 'Credit (paid)'}</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50/60 font-medium">
                <td colSpan={6}>Opening balance</td>
                <td className="text-right">{formatMoney(data.opening)}</td>
              </tr>
              {data.entries.map((e) => (
                <tr key={e._id}>
                  <td className="whitespace-nowrap">{formatDate(e.date)}</td>
                  <td>{titleCase(e.type)}</td>
                  <td className="font-medium">{e.refNo}</td>
                  <td className="max-w-xs truncate text-slate-600" title={e.narration}>
                    {e.narration}
                  </td>
                  <td className="text-right">{e.debit ? formatMoney(e.debit) : ''}</td>
                  <td className="text-right">{e.credit ? formatMoney(e.credit) : ''}</td>
                  <td className="text-right font-medium tabular-nums">{formatMoney(e.runningBalance)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td colSpan={4}>Closing balance {vendor ? (data.closing >= 0 ? '(payable)' : '(advance with vendor)') : data.closing >= 0 ? '(receivable)' : '(advance held)'}</td>
                <td className="text-right">{formatMoney(data.totalDebit)}</td>
                <td className="text-right">{formatMoney(data.totalCredit)}</td>
                <td className="text-right">{formatMoney(data.closing)}</td>
              </tr>
            </tbody>
          </table>
          {!data.entries.length && <EmptyState title="No ledger entries in this period" />}
        </div>
      )}
    </div>
  );
}
