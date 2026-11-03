import { env } from '../config/env';

/**
 * Date helpers. All calendar logic ("today", day boundaries, YYYY-MM-DD keys) uses the SHOP's time zone,
 * not the server's: hosted servers run in UTC, which would start the shop's day at the wrong hour.
 * Date-only strings (YYYY-MM-DD) are interpreted in that zone.
 */
function resolveTimeZone(): string {
  // Hosting platforms often set TZ=":UTC"; the leading colon is not a valid IANA name (MongoDB rejects it).
  const candidates = [env.SHOP_TIMEZONE, process.env.TZ?.replace(/^:/, ''), Intl.DateTimeFormat().resolvedOptions().timeZone];
  for (const tz of candidates) {
    if (!tz) continue;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      // not a valid time zone - try the next one
    }
  }
  return 'UTC';
}

export const TIME_ZONE = resolveTimeZone();

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Wall-clock date and time of an instant as seen in the shop's time zone. */
function zoned(d: Date) {
  const p = Object.fromEntries(partsFormat.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** Milliseconds the shop's time zone is ahead of UTC at instant `d`. */
function offsetAt(d: Date): number {
  const z = zoned(d);
  return Date.UTC(z.y, z.m - 1, z.d, z.h, z.min, z.s) - (d.getTime() - d.getUTCMilliseconds());
}

/** The instant at which the shop's wall clock shows the given date and time (month is 1-based; days may overflow). */
function fromZoned(y: number, m: number, day: number, h = 0, min = 0, s = 0, ms = 0): Date {
  const wall = Date.UTC(y, m - 1, day, h, min, s, ms);
  const offset = offsetAt(new Date(wall));
  const corrected = offsetAt(new Date(wall - offset)); // differs only across a DST change
  return new Date(wall - corrected);
}

export function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return fromZoned(Number(m[1]), Number(m[2]), Number(m[3]));
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

export function startOfDay(d: Date): Date {
  const z = zoned(d);
  return fromZoned(z.y, z.m, z.d);
}

export function endOfDay(d: Date): Date {
  const z = zoned(d);
  return fromZoned(z.y, z.m, z.d, 23, 59, 59, 999);
}

export function addDays(d: Date, days: number): Date {
  const z = zoned(d);
  return fromZoned(z.y, z.m, z.d + days, z.h, z.min, z.s, d.getUTCMilliseconds());
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
  const z = zoned(d);
  return `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
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
