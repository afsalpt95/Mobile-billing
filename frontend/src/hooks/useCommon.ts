'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { setPrecision } from '@/lib/money';
import { qk } from '@/lib/queryKeys';
import { setCurrency } from '@/lib/utils';
import { masterService, repairService, settingsService } from '@/services';

export function useDebounce<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useSettings() {
  const query = useQuery({ queryKey: qk.settings, queryFn: settingsService.get, staleTime: 10 * 60_000 });
  useEffect(() => {
    if (query.data) {
      setCurrency({ symbol: query.data.currencySymbol, code: query.data.currencyCode, precision: query.data.currencyPrecision });
      setPrecision(query.data.currencyPrecision ?? 2);
    }
  }, [query.data]);
  return query;
}

export function usePaymentMethods() {
  return useQuery({ queryKey: qk.master('payment-methods'), queryFn: masterService.paymentMethods, staleTime: 10 * 60_000 });
}

export function useTechnicians() {
  return useQuery({ queryKey: ['technicians'], queryFn: repairService.technicians, staleTime: 10 * 60_000 });
}

/** Invalidate many query roots at once after a posting. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: ReadonlyArray<readonly unknown[]>) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}
