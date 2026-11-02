'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PrintFrame, ShopHeader, SignatureRow } from '@/features/print/PrintFrame';
import { useSettings } from '@/hooks/useCommon';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/lib/utils';
import { repairService } from '@/services';

export default function RepairReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const { data: settings } = useSettings();
  const { data: r, isLoading, error } = useQuery({ queryKey: qk.repair(id), queryFn: () => repairService.get(id) });
  return (
    <PrintFrame loading={isLoading} error={error} ready={!!r} title={r ? `Job ${r.jobNo}` : 'Repair receipt'}>
      {r && (
        <div>
          <ShopHeader
            settings={settings}
            docTitle="Repair Job Receipt"
            meta={[
              ['Job No', <b key="j">{r.jobNo}</b>],
              ['Received', formatDateTime(r.receivedAt)],
              ['Status', titleCase(r.status)],
              ...(r.expectedDeliveryAt ? ([['Expected', formatDate(r.expectedDeliveryAt)]] as Array<[string, string]>) : []),
            ]}
          />
          <div className="mt-4 grid grid-cols-2 gap-6">
            <Section title="Customer">
              <div>
                <span className="font-semibold">{r.customerName}</span>
                {r.contactNumber && <span> · {r.contactNumber}</span>}
              </div>
            </Section>
            <Section title="Device">
              <div className="font-semibold">{[r.brandName, r.deviceModelName].filter(Boolean).join(' ') || '—'}</div>
              {r.deviceCategoryName && <div>{r.deviceCategoryName}</div>}
              {r.imei && <div className="font-mono">IMEI/SN: {r.imei}</div>}
            </Section>
          </div>
          <div className="mt-4 space-y-3">
            <Section title="Customer complaint">{r.complaint}</Section>
            {r.conditionAtReceipt && <Section title="Condition at receipt">{r.conditionAtReceipt}</Section>}
            {r.accessoriesReceived && <Section title="Accessories received">{r.accessoriesReceived}</Section>}
            {r.diagnosis && <Section title="Diagnosis">{r.diagnosis}</Section>}
            {r.customerNotes && <Section title="Notes">{r.customerNotes}</Section>}
          </div>
          <table className="mt-4 w-full text-[12px]">
            <tbody>
              <Tr k="Estimated cost" v={formatMoney(r.estimatedCost)} />
              {r.approvedCost > 0 && <Tr k="Approved cost" v={formatMoney(r.approvedCost)} />}
              <Tr k="Advance paid" v={formatMoney(r.advancePaid)} />
              {r.sale ? <Tr k={`Invoice ${r.invoiceNo}`} v={`Balance ${formatMoney(r.sale.balanceDue)}`} /> : <Tr k="Estimated balance" v={formatMoney(Math.max(r.estimate.total, r.estimatedCost) - r.advancePaid)} />}
              {r.warrantyType !== 'NONE' && <Tr k="Repair warranty" v={`${titleCase(r.warrantyType)} · ${r.warrantyDays} days${r.warrantyExpiry ? ` (till ${formatDate(r.warrantyExpiry)})` : ''}`} />}
            </tbody>
          </table>
          <div className="mt-4 rounded border border-slate-300 p-2 text-[11px] text-slate-600">
            Please bring this receipt when collecting the device. The shop is not responsible for data loss or for devices not collected within 60 days.
            {settings?.warranty?.terms ? ` ${settings.warranty.terms}` : ''}
          </div>
          <SignatureRow />
        </div>
      )}
    </PrintFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase">{title}</div>
      <div className="whitespace-pre-line">{children}</div>
    </div>
  );
}

function Tr({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-slate-200">
      <td className="py-1 text-slate-600">{k}</td>
      <td className="py-1 text-right font-medium">{v}</td>
    </tr>
  );
}
