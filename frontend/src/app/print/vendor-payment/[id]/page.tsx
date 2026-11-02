'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PrintFrame, ShopHeader, SignatureRow } from '@/features/print/PrintFrame';
import { useSettings } from '@/hooks/useCommon';
import { formatDateTime, formatMoney, titleCase } from '@/lib/utils';
import { vendorPaymentService } from '@/services';

export default function VendorPaymentReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: settings } = useSettings();
  const { data: p, isLoading, error } = useQuery({ queryKey: ['payments', 'vendor', id], queryFn: () => vendorPaymentService.get(id) });
  return (
    <PrintFrame loading={isLoading} error={error} ready={!!p} title={p ? `Payment ${p.paymentNo}` : 'Payment voucher'}>
      {p && (
        <div>
          {p.status === 'CANCELLED' && <div className="mb-3 rounded border-2 border-red-500 py-1 text-center font-bold text-red-600">CANCELLED</div>}
          <ShopHeader settings={settings} docTitle={p.type === 'PAYMENT' ? 'Payment Voucher' : titleCase(p.type)} meta={[['Voucher No', <b key="v">{p.paymentNo}</b>], ['Date', formatDateTime(p.date)]]} />
          <div className="mt-4 text-[14px]">
            {p.type === 'REFUND_RECEIVED' ? 'Received from' : 'Paid to'} <b>{p.vendorName}</b> the sum of <b>{formatMoney(p.amount)}</b>
            {p.method && <> by {p.method}</>}
            {p.reference && <> (ref {p.reference})</>}.
          </div>
          {p.allocations.length > 0 && (
            <table className="mt-4 w-full text-[12px]">
              <thead>
                <tr className="border-y border-slate-400 bg-slate-50 text-left">
                  <th className="px-2 py-1">Purchase</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.purchase} className="border-b border-slate-200">
                    <td className="px-2 py-1">{a.purchaseNo}</td>
                    <td className="px-2 py-1 text-right">{formatMoney(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.advanceAmount > 0 && <div className="mt-2">Recorded as vendor advance: {formatMoney(p.advanceAmount)}</div>}
          {p.notes && <div className="mt-3 text-slate-600">Notes: {p.notes}</div>}
          <SignatureRow />
        </div>
      )}
    </PrintFrame>
  );
}
