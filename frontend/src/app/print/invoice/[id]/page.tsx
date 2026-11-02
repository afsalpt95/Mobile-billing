'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PrintFrame, ShopHeader, SignatureRow } from '@/features/print/PrintFrame';
import { useSettings } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/utils';
import { saleService } from '@/services';

export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const { data: settings } = useSettings();
  const { data: sale, isLoading, error } = useQuery({ queryKey: qk.sale(id), queryFn: () => saleService.get(id) });
  const taxEnabled = Boolean(settings?.tax?.enabled || (sale?.taxAmount ?? 0) > 0);
  const hasWarranty = sale?.items.some((i) => i.warranty?.expiryDate);

  return (
    <PrintFrame loading={isLoading} error={error} ready={!!sale} title={sale ? `Invoice ${sale.invoiceNo}` : 'Invoice'}>
      {sale && (
        <div>
          {sale.status === 'CANCELLED' && <div className="mb-3 rounded border-2 border-red-500 py-1 text-center font-bold text-red-600">CANCELLED — {sale.cancelReason}</div>}
          <ShopHeader
            settings={settings}
            docTitle={taxEnabled ? 'Tax Invoice' : 'Invoice'}
            meta={[
              ['Invoice No', <b key="n">{sale.invoiceNo}</b>],
              ['Date', formatDateTime(sale.date)],
              ...(sale.dueDate && sale.balanceDue > 0 ? ([['Due date', formatDate(sale.dueDate)]] as Array<[string, string]>) : []),
            ]}
          />
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase">Bill to</div>
              <div>
                <span className="font-semibold">{sale.customerName}</span>
                {sale.customerMobile && <span> · {sale.customerMobile}</span>}
              </div>
              {sale.customerDetails?.address && <div className="whitespace-pre-line text-slate-600">{sale.customerDetails.address}</div>}
            </div>
          </div>
          <table className="mt-4 w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-y border-slate-400 bg-slate-50 text-left">
                <th className="px-1.5 py-1.5">#</th>
                <th className="px-1.5 py-1.5">Item</th>
                <th className="px-1.5 py-1.5 text-right">Qty</th>
                <th className="px-1.5 py-1.5 text-right">Price</th>
                <th className="px-1.5 py-1.5 text-right">Disc.</th>
                {taxEnabled && <th className="px-1.5 py-1.5 text-right">{settings?.tax?.name ?? 'Tax'}</th>}
                <th className="px-1.5 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((it, i) => (
                <tr key={it._id} className="border-b border-slate-200 align-top">
                  <td className="px-1.5 py-1.5">{i + 1}</td>
                  <td className="px-1.5 py-1.5">
                    <div className="font-medium">{it.name}</div>
                    <div className="text-[11px] text-slate-600">
                      {[it.device?.brandName, it.device?.deviceModelName].filter(Boolean).join(' ') || it.description}
                      {it.device?.imei && ` · IMEI ${it.device.imei}`}
                    </div>
                    {it.complaint && <div className="text-[11px] text-slate-600">Issue: {it.complaint}</div>}
                    {it.serials?.length > 0 && <div className="font-mono text-[11px] text-slate-600">IMEI/SN: {it.serials.join(', ')}</div>}
                    {it.sparePart?.name && (
                      <div className="text-[11px] text-slate-600">
                        Spare used: {it.sparePart.name} × {it.sparePart.qty}
                      </div>
                    )}
                    {it.warranty?.expiryDate && <div className="text-[11px] text-emerald-700">Warranty valid till {formatDate(it.warranty.expiryDate)}</div>}
                    {it.returnedQty > 0 && <div className="text-[11px] text-red-600">Returned: {formatNumber(it.returnedQty)}</div>}
                  </td>
                  <td className="px-1.5 py-1.5 text-right">{formatNumber(it.qty)}</td>
                  <td className="px-1.5 py-1.5 text-right">{formatMoney(it.unitPrice)}</td>
                  <td className="px-1.5 py-1.5 text-right">{it.discount ? formatMoney(it.discount) : '-'}</td>
                  {taxEnabled && (
                    <td className="px-1.5 py-1.5 text-right">
                      {formatMoney(it.taxAmount)}
                      <div className="text-[10px] text-slate-500">{it.taxRate}%</div>
                    </td>
                  )}
                  <td className="px-1.5 py-1.5 text-right font-medium">{formatMoney(it.netTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex justify-between gap-6">
            <div className="max-w-[55%] space-y-1 text-[12px] text-slate-600">
              {sale.tendered?.length > 0 && <div>Paid by: {sale.tendered.map((t) => `${t.method} ${formatMoney(t.amount)}${t.reference ? ` (${t.reference})` : ''}`).join(', ')}</div>}
              {sale.payments && sale.payments.filter((p) => p.type !== 'REFUND' && p.source !== 'SALE').length > 0 && (
                <div>Other payments: {sale.payments.filter((p) => p.type !== 'REFUND' && p.source !== 'SALE').map((p) => `${p.receiptNo} ${formatMoney(p.allocations.find((a) => a.sale === sale._id)?.amount ?? p.amount)}`).join(', ')}</div>
              )}
              {sale.notes && <div>Notes: {sale.notes}</div>}
              {hasWarranty && settings?.warranty?.terms && <div className="mt-2">Warranty terms: {settings.warranty.terms}</div>}
            </div>
            <table className="w-64 text-[12px]">
              <tbody>
                <Tr k="Subtotal" v={formatMoney(sale.subtotal)} />
                {sale.itemDiscount > 0 && <Tr k="Item discounts" v={`- ${formatMoney(sale.itemDiscount)}`} />}
                {sale.billDiscount > 0 && <Tr k="Bill discount" v={`- ${formatMoney(sale.billDiscount)}`} />}
                {taxEnabled && <Tr k={settings?.tax?.name ?? 'Tax'} v={formatMoney(sale.taxAmount)} />}
                <Tr k="Grand total" v={formatMoney(sale.grandTotal)} strong />
                <Tr k="Amount paid" v={formatMoney(sale.amountPaid)} />
                {sale.returnedAmount > 0 && <Tr k="Returned" v={`- ${formatMoney(sale.returnedAmount)}`} />}
                {sale.refundedAmount > 0 && <Tr k="Refunded" v={formatMoney(sale.refundedAmount)} />}
                <Tr k="Balance due" v={formatMoney(sale.balanceDue)} strong />
                {sale.changeDue > 0 && <Tr k="Change given" v={formatMoney(sale.changeDue)} />}
              </tbody>
            </table>
          </div>
          {settings?.billing?.invoiceFooter && <div className="mt-6 text-center text-sm text-slate-600 italic">{settings.billing.invoiceFooter}</div>}
          <SignatureRow />
        </div>
      )}
    </PrintFrame>
  );
}

function Tr({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'border-t border-slate-400 font-bold' : ''}>
      <td className="py-0.5 pr-3 text-slate-600">{k}</td>
      <td className="py-0.5 text-right tabular-nums">{v}</td>
    </tr>
  );
}
