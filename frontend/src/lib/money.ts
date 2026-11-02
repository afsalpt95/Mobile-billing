/**
 * Client-side mirror of the backend bill calculation (backend/src/services/calc.service.ts),
 * used for instant totals while typing. The server always recalculates and is authoritative.
 */
let precision = 2;
export const setPrecision = (p: number) => {
  precision = p;
};
const factor = () => 10 ** precision;

export const toMinor = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(Number((n * factor()).toFixed(6))) : 0;
};
export const fromMinor = (m: number) => Number((m / factor()).toFixed(precision));
export const round = (v: number | string | null | undefined) => fromMinor(toMinor(v));
export const add = (...v: Array<number | null | undefined>) => fromMinor(v.reduce<number>((a, x) => a + toMinor(x), 0));
export const sub = (a: number, ...v: number[]) => fromMinor(v.reduce((acc, x) => acc - toMinor(x), toMinor(a)));
export const mul = (price: number, qty: number) => fromMinor(Math.round(Number((toMinor(price) * qty).toFixed(6))));
export const percentOf = (amount: number, rate: number) => fromMinor(Math.round(Number(((toMinor(amount) * rate) / 100).toFixed(6))));

export function allocate(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const totalMinor = toMinor(total);
  const wSum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (wSum <= 0) return weights.map((_, i) => (i === 0 ? round(total) : 0));
  const raw = weights.map((w) => (Math.max(0, w) / wSum) * totalMinor);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = totalMinor - floored.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) floored[order[k].i] += 1;
  return floored.map(fromMinor);
}

export interface BillLine {
  qty: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export function calculateBill(lines: BillLine[], billDiscount: number, taxEnabled: boolean) {
  const base = lines.map((l) => {
    const gross = mul(Number(l.unitPrice) || 0, Number(l.qty) || 0);
    const discount = round(l.discount ?? 0);
    return { gross, discount, lineTotal: sub(gross, discount) };
  });
  const afterItems = add(...base.map((b) => b.lineTotal));
  const billDisc = Math.min(round(billDiscount || 0), afterItems);
  const shares = allocate(billDisc, base.map((b) => Math.max(b.lineTotal, 0)));
  const calc = base.map((b, i) => {
    const taxable = sub(b.lineTotal, shares[i] ?? 0);
    const tax = taxEnabled && lines[i].taxRate ? percentOf(taxable, lines[i].taxRate!) : 0;
    return { ...b, share: shares[i] ?? 0, taxable, tax, net: add(taxable, tax) };
  });
  return {
    lines: calc,
    subtotal: add(...base.map((b) => b.gross)),
    itemDiscount: add(...base.map((b) => b.discount)),
    billDiscount: billDisc,
    taxable: add(...calc.map((c) => c.taxable)),
    tax: add(...calc.map((c) => c.tax)),
    grandTotal: add(...calc.map((c) => c.net)),
  };
}

/** Splits tendered payments into applied amount, balance due and change (change only from cash). */
export function paymentSummary(grandTotal: number, payments: Array<{ amount: number; isCash: boolean }>) {
  const tendered = add(...payments.map((p) => Number(p.amount) || 0));
  const cash = add(...payments.filter((p) => p.isCash).map((p) => Number(p.amount) || 0));
  const over = tendered > grandTotal ? sub(tendered, grandTotal) : 0;
  const invalidOverpay = over > cash;
  const applied = sub(tendered, over);
  return { tendered, applied, balanceDue: sub(grandTotal, applied), changeDue: over, invalidOverpay };
}
