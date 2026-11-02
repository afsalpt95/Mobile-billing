'use client';

import { Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, MoneyInput, Select } from '@/components/ui/Field';
import { usePaymentMethods, useSettings } from '@/hooks/useCommon';
import { add } from '@/lib/money';
import { formatMoney } from '@/lib/utils';

export interface PayRow {
  method: string;
  amount: string;
  reference: string;
}

export const emptyPayRow = (method = 'Cash'): PayRow => ({ method, amount: '', reference: '' });
export const payRowsTotal = (rows: PayRow[]) => add(...rows.map((r) => Number(r.amount) || 0));
export const payRowsToApi = (rows: PayRow[]) =>
  rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount), reference: r.reference || undefined }));

/** Controlled split-payment editor (method + amount + reference rows). */
export function PaymentRows({ rows, onChange, allowSplit = true }: { rows: PayRow[]; onChange: (rows: PayRow[]) => void; allowSplit?: boolean }) {
  const { data: methods = [] } = usePaymentMethods();
  const { data: settings } = useSettings();
  const cash = new Set(methods.filter((m) => m.kind === 'CASH').map((m) => m.name));
  const set = (i: number, patch: Partial<PayRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
          <Select value={r.method} onChange={(e) => set(i, { method: e.target.value })} aria-label="Payment method">
            {methods.map((m) => (
              <option key={m._id} value={m.name}>
                {m.name}
              </option>
            ))}
          </Select>
          <MoneyInput value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} placeholder="0" aria-label="Amount" />
          {rows.length > 1 ? (
            <IconButton label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </IconButton>
          ) : (
            <span className="w-8" />
          )}
          {!cash.has(r.method) && <Input className="col-span-2 h-8 py-1 text-xs" placeholder="Transaction / reference no." value={r.reference} onChange={(e) => set(i, { reference: e.target.value })} />}
        </div>
      ))}
      {allowSplit && (
        <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...rows, emptyPayRow(settings?.billing?.defaultPaymentMethod)])}>
          Split payment
        </Button>
      )}
      {rows.length > 1 && <div className="text-right text-sm text-slate-600">Total {formatMoney(payRowsTotal(rows))}</div>}
    </div>
  );
}
