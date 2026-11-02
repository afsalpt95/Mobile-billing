/**
 * Decimal-safe money helpers.
 *
 * All arithmetic is performed on integers in minor units (e.g. paise / cents) and
 * converted back to a decimal number rounded to the configured currency precision,
 * so stored monetary values are always exact at that precision.
 */
let precision = 2;

export function setMoneyPrecision(p: number): void {
  if (!Number.isInteger(p) || p < 0 || p > 3) throw new Error('Currency precision must be an integer 0-3');
  precision = p;
}

export function getMoneyPrecision(): number {
  return precision;
}

const factor = () => 10 ** precision;

export function toMinor(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  // toFixed strips binary floating point noise (e.g. 1.005 * 100 = 100.49999...)
  return Math.round(Number((n * factor()).toFixed(6)));
}

export function fromMinor(minor: number): number {
  return Number((minor / factor()).toFixed(precision));
}

export function round(value: number | string | null | undefined): number {
  return fromMinor(toMinor(value));
}

export function add(...values: Array<number | null | undefined>): number {
  return fromMinor(values.reduce<number>((acc, v) => acc + toMinor(v), 0));
}

export function sub(a: number, ...values: number[]): number {
  return fromMinor(values.reduce((acc, v) => acc - toMinor(v), toMinor(a)));
}

/** price * qty (qty may be fractional for weight/length units) */
export function mul(price: number, qty: number): number {
  return fromMinor(Math.round(Number((toMinor(price) * qty).toFixed(6))));
}

/** amount * rate / 100 */
export function percentOf(amount: number, rate: number): number {
  return fromMinor(Math.round(Number(((toMinor(amount) * rate) / 100).toFixed(6))));
}

/** Per-unit cost kept with 4 decimals so weighted averages do not drift. */
export function unitCost(amount: number, qty: number): number {
  if (!qty) return 0;
  return Number((amount / qty).toFixed(4));
}

/** Split `total` across `weights` proportionally; parts always sum exactly to `total`. */
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

export const min = (a: number, b: number) => (toMinor(a) <= toMinor(b) ? round(a) : round(b));
export const max = (a: number, b: number) => (toMinor(a) >= toMinor(b) ? round(a) : round(b));
export const isZero = (a: number) => toMinor(a) === 0;
export const gt = (a: number, b: number) => toMinor(a) > toMinor(b);
export const gte = (a: number, b: number) => toMinor(a) >= toMinor(b);
export const lt = (a: number, b: number) => toMinor(a) < toMinor(b);
