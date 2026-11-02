'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SerialPicker } from '@/features/billing/SerialPicker';
import { useInvalidate, usePaymentMethods } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { add, round, sub } from '@/lib/money';
import { financialKeys } from '@/lib/queryKeys';
import { formatMoney, formatNumber } from '@/lib/utils';
import { purchaseService, saleService } from '@/services';
import type { Purchase, Sale } from '@/types';

/** Customer return against an invoice. Restock or send to damaged stock per line. */
export function SalesReturnModal({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const invalidate = useInvalidate();
  const { data: methods = [] } = usePaymentMethods();
  const [lines, setLines] = useState<Record<string, { qty: string; restock: boolean; serials: string[] }>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('Cash');
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (!open) return;
    setLines(Object.fromEntries(sale.items.map((i) => [i._id, { qty: '', restock: true, serials: [] }])));
    setReason('');
    setRefundMethod(sale.tendered?.[0]?.method ?? 'Cash');
    requestId.current = newRequestId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sale._id]);

  // Estimate (server computes the exact pro-rata value incl. bill discount and tax)
  const estimate = add(
    ...sale.items.map((i) => {
      const q = Number(lines[i._id]?.qty) || 0;
      if (!q) return 0;
      return i.returnedQty + q >= i.qty ? sub(i.netTotal, i.returnedAmount ?? 0) : round((i.netTotal * q) / i.qty);
    }),
  );
  const adjust = Math.min(estimate, sale.balanceDue);
  const refund = sub(estimate, adjust);

  const save = useMutation({
    mutationFn: () =>
      saleService.return(sale._id, {
        clientRequestId: requestId.current,
        items: Object.entries(lines)
          .filter(([, l]) => Number(l.qty) > 0)
          .map(([saleItemId, l]) => ({ saleItemId, qty: Number(l.qty), restock: l.restock, serials: l.serials.length ? l.serials : undefined })),
        reason,
        refundMethod,
      }),
    onSuccess: async ({ data, meta }) => {
      toast.success(meta?.duplicate ? `Already recorded as ${data.returnNo}` : `Return ${data.returnNo} saved${data.refundAmount ? ` — refund ${formatMoney(data.refundAmount)}` : ''}`);
      await invalidate(...financialKeys);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const anyQty = Object.values(lines).some((l) => Number(l.qty) > 0);
  const serialProblem = sale.items.some((i) => i.serials?.length && Number(lines[i._id]?.qty) > 0 && lines[i._id].serials.length !== Number(lines[i._id].qty));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Return items — ${sale.invoiceNo}`}
      description="Only quantities not already returned can be returned. Restocked items go back to sellable stock; others are recorded as damaged."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => save.mutate()} loading={save.isPending} disabled={!anyQty || !reason.trim() || serialProblem}>
            Process return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Sold</th>
                <th className="text-right">Returned</th>
                <th className="w-24 text-right">Return qty</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => {
                const eligible = i.qty - (i.returnedQty ?? 0);
                const l = lines[i._id] ?? { qty: '', restock: true, serials: [] };
                const set = (patch: Partial<typeof l>) => setLines({ ...lines, [i._id]: { ...l, ...patch } });
                return (
                  <tr key={i._id} className="align-top">
                    <td>
                      <div className="font-medium">{i.name}</div>
                      <div className="text-xs text-slate-500">
                        {formatMoney(i.netTotal)} net{eligible <= 0 && ' · fully returned'}
                      </div>
                      {i.serials?.length > 0 && Number(l.qty) > 0 && (
                        <div className="mt-2 max-w-sm">
                          <SerialPicker productId={i.product!} value={l.serials} onChange={(s) => set({ serials: s })} max={Number(l.qty)} options={i.serials} />
                        </div>
                      )}
                    </td>
                    <td className="text-right">{formatNumber(i.qty)}</td>
                    <td className="text-right">{formatNumber(i.returnedQty)}</td>
                    <td>
                      <Input type="number" min={0} max={eligible} step="any" className="text-right" value={l.qty} disabled={eligible <= 0} onChange={(e) => set({ qty: e.target.value })} aria-label={`Return quantity for ${i.name}`} />
                      {Number(l.qty) > eligible && <div className="text-xs text-red-600">Max {eligible}</div>}
                    </td>
                    <td>
                      {i.itemType === 'PRODUCT' ? (
                        <Select value={l.restock ? 'yes' : 'no'} onChange={(e) => set({ restock: e.target.value === 'yes' })} className="h-9 py-1">
                          <option value="yes">Restock (resellable)</option>
                          <option value="no">Damaged</option>
                        </Select>
                      ) : (
                        <span className="text-xs text-slate-500">Service — no stock</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Return reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <div className="space-y-2">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Estimated return value</span>
                <b>{formatMoney(estimate)}</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Adjusted against balance due</span>
                <span>{formatMoney(adjust)}</span>
              </div>
              <div className="flex justify-between text-slate-900">
                <span>Refund to customer</span>
                <b>{formatMoney(refund)}</b>
              </div>
            </div>
            {refund > 0 && (
              <Field label="Refund method">
                <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                  {methods.map((m) => (
                    <option key={m._id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Vendor return against a received purchase. */
export function PurchaseReturnModal({ purchase, open, onClose }: { purchase: Purchase; open: boolean; onClose: () => void }) {
  const invalidate = useInvalidate();
  const { data: methods = [] } = usePaymentMethods();
  const [lines, setLines] = useState<Record<string, { qty: string; serials: string[] }>>({});
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState<'CREDIT_NOTE' | 'REFUND'>('CREDIT_NOTE');
  const [refundMethod, setRefundMethod] = useState('Cash');
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (!open) return;
    setLines(Object.fromEntries(purchase.items.map((i) => [i._id, { qty: '', serials: [] }])));
    setReason('');
    setSettlement('CREDIT_NOTE');
    requestId.current = newRequestId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, purchase._id]);

  const estimate = add(
    ...purchase.items.map((i) => {
      const q = Number(lines[i._id]?.qty) || 0;
      const units = i.receivedQty || i.qty + i.freeQty;
      return q ? round(((i.lineTotal + i.taxAmount) * q) / units) : 0;
    }),
  );
  const adjust = Math.min(estimate, purchase.balanceDue);
  const remainder = sub(estimate, adjust);

  const save = useMutation({
    mutationFn: () =>
      purchaseService.return(purchase._id, {
        clientRequestId: requestId.current,
        items: Object.entries(lines)
          .filter(([, l]) => Number(l.qty) > 0)
          .map(([purchaseItemId, l]) => ({ purchaseItemId, qty: Number(l.qty), serials: l.serials.length ? l.serials : undefined })),
        reason,
        settlement,
        refundMethod: settlement === 'REFUND' ? refundMethod : undefined,
      }),
    onSuccess: async ({ data }) => {
      toast.success(`Vendor return ${data.returnNo} saved`);
      await invalidate(...financialKeys);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const anyQty = Object.values(lines).some((l) => Number(l.qty) > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Return to vendor — ${purchase.purchaseNo}`}
      description="Stock is removed at its landed cost. The credit first reduces this purchase's balance; any remainder is refunded or kept as a vendor credit note."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => save.mutate()} loading={save.isPending} disabled={!anyQty || !reason.trim()}>
            Process vendor return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Received</th>
                <th className="text-right">Returned</th>
                <th className="w-24 text-right">Return qty</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((i) => {
                const units = i.receivedQty || i.qty + i.freeQty;
                const eligible = units - i.returnedQty;
                const l = lines[i._id] ?? { qty: '', serials: [] };
                const set = (patch: Partial<typeof l>) => setLines({ ...lines, [i._id]: { ...l, ...patch } });
                return (
                  <tr key={i._id} className="align-top">
                    <td>
                      <div className="font-medium">{i.name}</div>
                      {i.serials?.length > 0 && Number(l.qty) > 0 && (
                        <div className="mt-2 max-w-sm">
                          <SerialPicker productId={i.product} value={l.serials} onChange={(s) => set({ serials: s })} max={Number(l.qty)} options={i.serials} />
                        </div>
                      )}
                    </td>
                    <td className="text-right">{formatNumber(units)}</td>
                    <td className="text-right">{formatNumber(i.returnedQty)}</td>
                    <td>
                      <Input type="number" min={0} max={eligible} className="text-right" value={l.qty} disabled={eligible <= 0} onChange={(e) => set({ qty: e.target.value })} aria-label={`Return quantity for ${i.name}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Return reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <div className="space-y-2">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span>Estimated credit</span>
                <b>{formatMoney(estimate)}</b>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Reduces this purchase&apos;s balance</span>
                <span>{formatMoney(adjust)}</span>
              </div>
              <div className="flex justify-between">
                <span>Remainder</span>
                <b>{formatMoney(remainder)}</b>
              </div>
            </div>
            {remainder > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Remainder as">
                  <Select value={settlement} onChange={(e) => setSettlement(e.target.value as 'REFUND' | 'CREDIT_NOTE')}>
                    <option value="CREDIT_NOTE">Vendor credit note</option>
                    <option value="REFUND">Refund received</option>
                  </Select>
                </Field>
                {settlement === 'REFUND' && (
                  <Field label="Received by">
                    <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                      {methods.map((m) => (
                        <option key={m._id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
