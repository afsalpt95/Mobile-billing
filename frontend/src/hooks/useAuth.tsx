'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { setUnauthorizedHandler } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { authService } from '@/services';
import type { Me } from '@/types';

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  can: (permission: string) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading, refetch } = useQuery({
    queryKey: qk.me,
    queryFn: () => authService.me().catch(() => null),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(qk.me, null);
      if (!window.location.pathname.startsWith('/login')) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    });
  }, [qc, router]);

  useEffect(() => {
    if (!isLoading && !data && !pathname.startsWith('/login')) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, data, pathname, router]);

  const logout = useCallback(async () => {
    await authService.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(qk.me, null);
    router.replace('/login');
  }, [qc, router]);

  const can = useCallback((p: string) => Boolean(data?.permissions?.includes(p)), [data]);

  return <Ctx.Provider value={{ user: data ?? null, loading: isLoading, can, logout, refresh: refetch }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
