'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PrintFrame, ShopHeader, SignatureRow } from '@/features/print/PrintFrame';
import { useSettings } from '@/hooks/useCommon';
import { formatDateTime, formatMoney } from '@/lib/utils';
import { customerPaymentService } from '@/services';

export default function CustomerReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: settings } = useSettings();
  const { data: p, isLoading, error } = useQuery({ queryKey: ['payments', 'customer', id], queryFn: () => customerPaymentService.get(id) });
  const title = p?.type === 'REFUND' ? 'Refund Voucher' : p?.type === 'ADVANCE' ? 'Advance Receipt' : 'Payment Receipt';
  return (
    <PrintFrame loading={isLoading} error={error} ready={!!p} title={p ? `${title} ${p.receiptNo}` : 'Receipt'}>
      {p && (
        <div>
          {p.status === 'CANCELLED' && <div className="mb-3 rounded border-2 border-red-500 py-1 text-center font-bold text-red-600">CANCELLED</div>}
          <ShopHeader settings={settings} docTitle={title} meta={[['Receipt No', <b key="r">{p.receiptNo}</b>], ['Date', formatDateTime(p.date)]]} />
          <div className="mt-4 text-[14px]">
            {p.type === 'REFUND' ? 'Paid to' : 'Received with thanks from'} <b>{p.customerName}</b>
            {p.customerMobile && <> ({p.customerMobile})</>} the sum of <b>{formatMoney(p.amount)}</b>
            {p.methods.length > 0 && <> by {p.methods.map((m) => `${m.method}${m.reference ? ` (ref ${m.reference})` : ''}`).join(', ')}</>}.
          </div>
          {p.allocations.length > 0 && (
            <table className="mt-4 w-full text-[12px]">
              <thead>
                <tr className="border-y border-slate-400 bg-slate-50 text-left">
                  <th className="px-2 py-1">Applied to invoice</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.sale} className="border-b border-slate-200">
                    <td className="px-2 py-1">{a.invoiceNo}</td>
                    <td className="px-2 py-1 text-right">{formatMoney(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!p.unallocated && p.unallocated > 0 && <div className="mt-2 text-sm">Advance held: {formatMoney(p.unallocated)}</div>}
          {p.notes && <div className="mt-3 text-slate-600">Notes: {p.notes}</div>}
          <SignatureRow />
        </div>
      )}
    </PrintFrame>
  );
}
