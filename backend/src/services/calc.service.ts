import { add, allocate, gt, mul, percentOf, round, sub } from '../utils/money';
import { ApiError } from '../utils/ApiError';

/** Pure bill/purchase calculations shared by services and unit tests. */

export interface SaleLineInput {
  qty: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export interface SaleLineCalc {
  gross: number;
  lineTotal: number;
  billDiscountShare: number;
  taxableAmount: number;
  taxAmount: number;
  netTotal: number;
}

export interface SaleTotals {
  lines: SaleLineCalc[];
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
}

/**
 * subtotal      = sum(qty * unitPrice)
 * lineTotal     = qty * unitPrice - lineDiscount
 * billDiscount  is spread over lines in proportion to lineTotal (exact to the minor unit)
 * taxable       = lineTotal - billDiscountShare
 * tax           = taxable * rate% (only when tax is enabled)
 * grandTotal    = sum(taxable + tax)
 */
export function calculateSale(lines: SaleLineInput[], billDiscount: number, taxEnabled: boolean): SaleTotals {
  const base = lines.map((l) => {
    const gross = mul(l.unitPrice, l.qty);
    const discount = round(l.discount ?? 0);
    if (gt(discount, gross)) throw ApiError.validation('Line discount cannot exceed the line amount');
    return { gross, discount, lineTotal: sub(gross, discount) };
  });
  const afterItems = add(...base.map((b) => b.lineTotal));
  const billDisc = round(billDiscount ?? 0);
  if (billDisc < 0) throw ApiError.validation('Bill discount cannot be negative');
  if (gt(billDisc, afterItems)) throw ApiError.validation('Bill discount cannot exceed the bill amount');
  const shares = allocate(billDisc, base.map((b) => b.lineTotal));

  const calc = base.map((b, i) => {
    const taxableAmount = sub(b.lineTotal, shares[i]);
    const rate = taxEnabled ? lines[i].taxRate ?? 0 : 0;
    const taxAmount = rate > 0 ? percentOf(taxableAmount, rate) : 0;
    return {
      gross: b.gross,
      lineTotal: b.lineTotal,
      billDiscountShare: shares[i],
      taxableAmount,
      taxAmount,
      netTotal: add(taxableAmount, taxAmount),
    };
  });

  return {
    lines: calc,
    subtotal: add(...base.map((b) => b.gross)),
    itemDiscount: add(...base.map((b) => b.discount)),
    billDiscount: billDisc,
    taxableAmount: add(...calc.map((c) => c.taxableAmount)),
    taxAmount: add(...calc.map((c) => c.taxAmount)),
    grandTotal: add(...calc.map((c) => c.netTotal)),
  };
}

export interface PurchaseLineInput {
  qty: number;
  freeQty?: number;
  unitCost: number;
  discount?: number;
  taxRate?: number;
}

export interface PurchaseTotals {
  lines: Array<{ lineTotal: number; taxAmount: number; chargesShare: number; landedUnitCost: number }>;
  subtotal: number;
  discount: number;
  taxAmount: number;
  charges: number;
  grandTotal: number;
}

/**
 * lineTotal       = qty * unitCost - discount
 * tax             = lineTotal * rate%
 * charges         = shipping + other, allocated to lines by value
 * landedUnitCost  = (lineTotal [+ tax if tax is a cost] + chargesShare) / (qty + freeQty)
 */
export function calculatePurchase(
  lines: PurchaseLineInput[],
  shipping: number,
  other: number,
  taxInCost: boolean,
): PurchaseTotals {
  const base = lines.map((l) => {
    const gross = mul(l.unitCost, l.qty);
    const discount = round(l.discount ?? 0);
    if (gt(discount, gross)) throw ApiError.validation('Line discount cannot exceed the line amount');
    const lineTotal = sub(gross, discount);
    const taxAmount = l.taxRate ? percentOf(lineTotal, l.taxRate) : 0;
    return { gross, discount, lineTotal, taxAmount, costBase: taxInCost ? add(lineTotal, taxAmount) : lineTotal };
  });
  const charges = add(shipping ?? 0, other ?? 0);
  const shares = allocate(charges, base.map((b) => b.costBase || b.gross || 1));
  const out = base.map((b, i) => {
    const units = lines[i].qty + (lines[i].freeQty ?? 0);
    const landed = units > 0 ? Number(((b.costBase + shares[i]) / units).toFixed(4)) : 0;
    return { lineTotal: b.lineTotal, taxAmount: b.taxAmount, chargesShare: shares[i], landedUnitCost: landed };
  });
  const subtotal = add(...base.map((b) => b.gross));
  const discount = add(...base.map((b) => b.discount));
  const taxAmount = add(...base.map((b) => b.taxAmount));
  return {
    lines: out,
    subtotal,
    discount,
    taxAmount,
    charges,
    grandTotal: add(sub(subtotal, discount), taxAmount, charges),
  };
}

export function paymentStatus(total: number, balance: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (round(balance) <= 0) return 'PAID';
  if (round(balance) < round(total)) return 'PARTIAL';
  return 'UNPAID';
}

/**
 * Value of `qty` units out of a line, taking the exact remainder for the final units so that
 * returning a line in several parts sums exactly to the original line value.
 */
export function proportionalValue(lineValue: number, alreadyReturned: number, lineQty: number, alreadyQty: number, qty: number): number {
  if (alreadyQty + qty >= lineQty) return sub(lineValue, alreadyReturned);
  return round((lineValue * qty) / lineQty);
}
