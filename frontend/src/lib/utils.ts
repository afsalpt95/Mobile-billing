import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

let currency = { symbol: '₹', code: 'INR', precision: 2 };
export function setCurrency(c: { symbol?: string; code?: string; precision?: number }) {
  currency = { symbol: c.symbol ?? currency.symbol, code: c.code ?? currency.code, precision: c.precision ?? currency.precision };
}

export function formatMoney(value: number | null | undefined, opts: { symbol?: boolean } = {}) {
  const n = Number(value ?? 0);
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: currency.precision, maximumFractionDigits: currency.precision });
  return opts.symbol === false ? s : `${currency.symbol}${s}`;
}

export function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** YYYY-MM-DD in local time (for date inputs and report filters). */
export function toDateInput(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function titleCase(s: string | null | undefined) {
  if (!s) return '';
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'prevMonth' | 'custom';

export function presetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const d = (y: number, m: number, day: number) => toDateInput(new Date(y, m, day));
  switch (preset) {
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: toDateInput(y), to: toDateInput(y) };
    }
    case 'week': {
      const start = new Date(now);
      const dow = (start.getDay() + 6) % 7; // Monday start
      start.setDate(start.getDate() - dow);
      return { from: toDateInput(start), to: toDateInput(now) };
    }
    case 'month':
      return { from: d(now.getFullYear(), now.getMonth(), 1), to: toDateInput(now) };
    case 'prevMonth':
      return { from: d(now.getFullYear(), now.getMonth() - 1, 1), to: d(now.getFullYear(), now.getMonth(), 0) };
    default:
      return { from: toDateInput(now), to: toDateInput(now) };
  }
}

/** List endpoints take ISO-ish datetimes; send local-day bounds so filters match the shop's calendar day. */
export function listRange(r: { from: string; to: string }) {
  return { from: r.from ? `${r.from}T00:00:00` : undefined, to: r.to ? `${r.to}T23:59:59.999` : undefined };
}

/**
 * Opens a print page in a new tab. `noopener` makes Chrome run it in its own process: a tab that keeps a
 * link to the POS tab shares its process, and the print dialog there freezes the POS tab until it is closed.
 */
export function openPrint(url: string) {
  window.open(url, '_blank', 'noopener');
}

/**
 * Prints a print page (with ?print=1) from a hidden frame on the current page — no new tab. Used after an
 * async save, when a new tab would be popup-blocked. The frame removes itself after printing (see PrintFrame).
 */
export function printInBackground(url: string) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = url;
  document.body.appendChild(frame);
}
