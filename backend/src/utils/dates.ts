/**
 * Date helpers. The backend runs on the shop machine (local-first), so the server's local time zone
 * is the shop's time zone. Date-only strings (YYYY-MM-DD) are interpreted in that zone.
 */
export const TIME_ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export interface DateRange {
  from: Date;
  to: Date;
}

/** Inclusive range from YYYY-MM-DD strings; defaults to today. */
export function resolveRange(from?: string, to?: string): DateRange {
  const today = new Date();
  const f = from ? startOfDay(parseDateOnly(from)) : startOfDay(today);
  const t = to ? endOfDay(parseDateOnly(to)) : endOfDay(today);
  if (f > t) throw new Error('"from" date must be before "to" date');
  return { from: f, to: t };
}

export function todayRange(): DateRange {
  const now = new Date();
  return { from: startOfDay(now), to: endOfDay(now) };
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** List of YYYY-MM-DD keys covering the range (for filling chart gaps). */
export function dayKeys(range: DateRange, maxDays = 400): string[] {
  const keys: string[] = [];
  let d = startOfDay(range.from);
  while (d <= range.to && keys.length < maxDays) {
    keys.push(toDateKey(d));
    d = addDays(d, 1);
  }
  return keys;
}
