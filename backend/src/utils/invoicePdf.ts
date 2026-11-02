import PDFDocument from 'pdfkit';
import type { Response } from 'express';

interface Line {
  name: string;
  description?: string | null;
  qty: number;
  unitPrice: number;
  discount?: number | null;
  netTotal: number;
  taxAmount?: number | null;
  serials?: string[] | null;
  warranty?: { status?: string | null; expiryDate?: Date | null } | null;
}

interface InvoiceData {
  invoiceNo: string;
  date: Date;
  status: string;
  customerName: string;
  customerMobile?: string | null;
  items: Line[];
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  taxAmount: number;
  grandTotal: number;
  amountPaid: number;
  returnedAmount?: number | null;
  balanceDue: number;
  changeDue?: number | null;
  tendered?: Array<{ method: string; amount: number }> | null;
  notes?: string | null;
}

interface Shop {
  shopName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  taxRegistrationNo?: string | null;
  currencyCode?: string | null;
  currencyPrecision?: number | null;
  tax?: { enabled?: boolean | null; name?: string | null } | null;
  billing?: { invoiceFooter?: string | null } | null;
  warranty?: { terms?: string | null } | null;
}

/** Streams a printable A4 invoice PDF. Uses the currency code (built-in PDF fonts lack symbols like ₹). */
export function streamInvoicePdf(res: Response, sale: InvoiceData, shop: Shop) {
  const precision = shop.currencyPrecision ?? 2;
  const cur = shop.currencyCode ?? '';
  const fmt = (n: number) => `${cur} ${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: precision, maximumFractionDigits: precision })}`;
  const fmtDate = (d: Date) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${sale.invoiceNo}.pdf"`);
  doc.pipe(res);

  const left = 40;
  const right = 555;
  doc.font('Helvetica-Bold').fontSize(18).text(shop.shopName || 'Mobile Shop', left, 40);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  [shop.address, [shop.phone, shop.email].filter(Boolean).join('  |  '), shop.taxRegistrationNo ? `${shop.tax?.name ?? 'Tax'} No: ${shop.taxRegistrationNo}` : '']
    .filter(Boolean)
    .forEach((l) => doc.text(l as string));

  doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(sale.status === 'CANCELLED' ? 'INVOICE (CANCELLED)' : 'TAX INVOICE', left, 40, { align: 'right' });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Invoice No: ${sale.invoiceNo}`, { align: 'right' });
  doc.text(`Date: ${fmtDate(sale.date)}`, { align: 'right' });

  let y = 120;
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#ccc').stroke();
  y += 8;
  doc.font('Helvetica-Bold').text('Bill To', left, y);
  doc.font('Helvetica').text(`${sale.customerName}${sale.customerMobile ? `  (${sale.customerMobile})` : ''}`, left, y + 12);
  y += 36;

  const cols = [
    { label: '#', x: left, w: 20, align: 'left' as const },
    { label: 'Item', x: left + 20, w: 230, align: 'left' as const },
    { label: 'Qty', x: left + 250, w: 40, align: 'right' as const },
    { label: 'Price', x: left + 290, w: 80, align: 'right' as const },
    { label: 'Disc', x: left + 370, w: 60, align: 'right' as const },
    { label: 'Amount', x: left + 430, w: 85, align: 'right' as const },
  ];
  doc.rect(left, y, right - left, 18).fill('#f1f5f9');
  doc.fillColor('#000').font('Helvetica-Bold');
  cols.forEach((c) => doc.text(c.label, c.x + 3, y + 5, { width: c.w - 6, align: c.align }));
  y += 22;
  doc.font('Helvetica');

  sale.items.forEach((it, i) => {
    const extra: string[] = [];
    if (it.description) extra.push(it.description);
    if (it.serials?.length) extra.push(`IMEI/SN: ${it.serials.join(', ')}`);
    if (it.warranty?.expiryDate && it.warranty.status === 'NEW_WARRANTY') extra.push(`Warranty till ${new Date(it.warranty.expiryDate).toLocaleDateString('en-IN')}`);
    const nameHeight = doc.heightOfString(it.name, { width: 224 }) + (extra.length ? doc.heightOfString(extra.join('\n'), { width: 224 }) : 0);
    if (y + nameHeight > 740) {
      doc.addPage();
      y = 40;
    }
    doc.fontSize(9).text(String(i + 1), cols[0].x + 3, y, { width: cols[0].w - 6 });
    doc.text(it.name, cols[1].x + 3, y, { width: cols[1].w - 6 });
    if (extra.length) doc.fontSize(7.5).fillColor('#555').text(extra.join('\n'), cols[1].x + 3, doc.y, { width: cols[1].w - 6 }).fillColor('#000').fontSize(9);
    doc.text(String(it.qty), cols[2].x + 3, y, { width: cols[2].w - 6, align: 'right' });
    doc.text(fmt(it.unitPrice), cols[3].x + 3, y, { width: cols[3].w - 6, align: 'right' });
    doc.text(it.discount ? fmt(it.discount) : '-', cols[4].x + 3, y, { width: cols[4].w - 6, align: 'right' });
    doc.text(fmt(it.netTotal), cols[5].x + 3, y, { width: cols[5].w - 6, align: 'right' });
    y += Math.max(nameHeight, 12) + 6;
    doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#eee').stroke();
  });

  const totals: Array<[string, string, boolean?]> = [['Subtotal', fmt(sale.subtotal)]];
  if (sale.itemDiscount) totals.push(['Item discounts', `- ${fmt(sale.itemDiscount)}`]);
  if (sale.billDiscount) totals.push(['Bill discount', `- ${fmt(sale.billDiscount)}`]);
  if (shop.tax?.enabled || sale.taxAmount) totals.push([shop.tax?.name || 'Tax', fmt(sale.taxAmount)]);
  totals.push(['Grand Total', fmt(sale.grandTotal), true]);
  totals.push(['Amount Paid', fmt(sale.amountPaid)]);
  if (sale.returnedAmount) totals.push(['Returned', fmt(sale.returnedAmount)]);
  totals.push(['Balance Due', fmt(sale.balanceDue), true]);
  if (sale.changeDue) totals.push(['Change Given', fmt(sale.changeDue)]);

  if (y + totals.length * 15 > 760) {
    doc.addPage();
    y = 40;
  }
  y += 6;
  totals.forEach(([label, value, bold]) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9);
    doc.text(label, 330, y, { width: 120, align: 'right' });
    doc.text(value, 455, y, { width: 97, align: 'right' });
    y += 15;
  });

  doc.font('Helvetica').fontSize(8.5);
  if (sale.tendered?.length) {
    doc.text(`Paid by: ${sale.tendered.map((t) => `${t.method} ${fmt(t.amount)}`).join(', ')}`, left, y + 6);
    y = doc.y;
  }
  if (sale.notes) doc.text(`Notes: ${sale.notes}`, left, y + 6);
  if (shop.warranty?.terms) doc.fillColor('#555').text(`Warranty terms: ${shop.warranty.terms}`, left, doc.y + 8);
  if (shop.billing?.invoiceFooter) doc.fillColor('#000').font('Helvetica-Oblique').text(shop.billing.invoiceFooter, left, doc.y + 12, { align: 'center', width: right - left });
  doc.end();
}
