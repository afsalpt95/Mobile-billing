'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect, type Option } from '@/components/ui/SearchSelect';
import { fetchProducts, productOption } from '@/features/masters/options';
import { useInvalidate } from '@/hooks/useCommon';
import { errorMessage, newRequestId } from '@/lib/api';
import { financialKeys, qk } from '@/lib/queryKeys';
import { formatMoney, formatNumber } from '@/lib/utils';
import { inventoryService } from '@/services';
import type { Product } from '@/types';

/** Stock adjustment: found stock (in), lost stock (out) or damaged. Always creates a stock movement. */
export function AdjustmentModal({ open, onClose, product: initial }: { open: boolean; onClose: () => void; product?: Product | null }) {
  const invalidate = useInvalidate();
  const [product, setProduct] = useState<Option<Product> | null>(null);
  const [type, setType] = useState<'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'DAMAGED'>('ADJUSTMENT_OUT');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const requestId = useRef(newRequestId());
  useEffect(() => {
    if (!open) return;
    setProduct(initial ? productOption(initial) : null);
    setType('ADJUSTMENT_OUT');
    setQty('');
    setUnitCost('');
    setReason('');
    requestId.current = newRequestId();
  }, [open, initial]);
  const p = product?.data;
  const save = useMutation({
    mutationFn: () =>
      inventoryService.adjust({
        clientRequestId: requestId.current,
        productId: product?.value,
        type,
        qty: Number(qty),
        unitCost: type === 'ADJUSTMENT_IN' && unitCost !== '' ? Number(unitCost) : undefined,
        reason,
      }),
    onSuccess: async () => {
      toast.success('Stock adjusted');
      await invalidate(...financialKeys);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock adjustment"
      description="Use for stock count differences, lost items or damaged goods. Purchases, sales and returns adjust stock automatically."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!product || !(Number(qty) > 0) || !reason.trim()}>
            Save adjustment
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Product" required className="sm:col-span-2">
          <SearchSelect value={product} onChange={setProduct} queryKey={[...qk.products, 'adjust']} fetchOptions={fetchProducts('PHONE,SPARE_PART,ACCESSORY,CONSUMABLE,OTHER')} disabled={!!initial} />
          {p && (
            <span className="mt-1 text-xs text-slate-500">
              In stock {formatNumber(p.stockQty)} {p.unit} · avg cost {formatMoney(p.avgCost)}
              {p.trackSerial && ' · serial-tracked items cannot be adjusted manually'}
            </span>
          )}
        </Field>
        <Field label="Adjustment type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="ADJUSTMENT_OUT">Stock out (lost / count shortage)</option>
            <option value="DAMAGED">Damaged (move to damaged stock)</option>
            <option value="ADJUSTMENT_IN">Stock in (found / count excess)</option>
          </Select>
        </Field>
        <Field label="Quantity" required>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {type === 'ADJUSTMENT_IN' && (
          <Field label="Unit cost" hint={`Defaults to current average ${formatMoney(p?.avgCost ?? 0)}`}>
            <MoneyInput value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
        )}
        <Field label="Reason" required className="sm:col-span-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {p && Number(qty) > 0 && type !== 'ADJUSTMENT_IN' && (
          <p className="text-sm text-slate-600 sm:col-span-2">
            Write-off value ≈ <b>{formatMoney(Number(qty) * p.avgCost)}</b> (shown in Profit &amp; Loss as inventory write-off).
          </p>
        )}
      </div>
    </Modal>
  );
}
