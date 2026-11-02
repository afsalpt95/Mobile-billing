'use client';

import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorState, Spinner } from '@/components/ui/Misc';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useCommon';
import type { ShopSettings } from '@/types';

/** Print-ready page shell: toolbar (hidden when printing) + A4-width sheet. Auto-prints with ?print=1. */
export function PrintFrame({ loading, error, ready, children, title }: { loading: boolean; error?: unknown; ready: boolean; children: ReactNode; title: string }) {
  const { user, loading: authLoading } = useAuth();
  const { data: settings } = useSettings();
  const printed = useRef(false);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (ready && settings && !printed.current && new URLSearchParams(window.location.search).get('print') === '1') {
      printed.current = true;
      // Inside the hidden frame from printInBackground: remove the frame once the print dialog closes.
      const frame = window.frameElement;
      if (frame) window.addEventListener('afterprint', () => window.parent.setTimeout(() => frame.remove(), 0), { once: true });
      setTimeout(() => window.print(), 300);
    }
  }, [ready, settings]);

  if (authLoading || !user) return <Spinner className="min-h-screen" />;
  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}>
          Back
        </Button>
        <Button icon={<Printer className="h-4 w-4" />} onClick={() => window.print()} disabled={!ready}>
          Print
        </Button>
      </div>
      <div className="print-area mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-lg">
        {loading ? <Spinner /> : error ? <ErrorState error={error} /> : children}
      </div>
    </div>
  );
}

export function ShopHeader({ settings, docTitle, meta }: { settings?: ShopSettings; docTitle: string; meta: Array<[string, ReactNode]> }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-slate-300 pb-4">
      <div className="flex items-start gap-3">
        {settings?.logo ? <img src={settings.logo} alt="" className="h-14 w-14 object-contain" /> : null}
        <div>
          <div className="text-xl font-bold">{settings?.shopName}</div>
          {settings?.address && <div className="whitespace-pre-line text-slate-600">{settings.address}</div>}
          <div className="text-slate-600">{[settings?.phone, settings?.email].filter(Boolean).join(' · ')}</div>
          {settings?.taxRegistrationNo && (
            <div className="text-slate-600">
              {settings.tax?.name ?? 'Tax'} No: {settings.taxRegistrationNo}
            </div>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold tracking-wide uppercase">{docTitle}</div>
        {meta.map(([k, v]) => (
          <div key={k} className="text-slate-700">
            <span className="text-slate-500">{k}: </span>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SignatureRow() {
  return (
    <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-slate-500">
      <div className="border-t border-slate-300 pt-1">Customer signature</div>
      <div className="border-t border-slate-300 pt-1">Authorised signatory</div>
    </div>
  );
}
