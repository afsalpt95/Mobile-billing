'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Smartphone, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { authService } from '@/services';
import { loginSchema, type LoginValues } from '@/validations';

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });

  const next = () => {
    const n = new URLSearchParams(window.location.search).get('next');
    return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
  };

  useEffect(() => {
    if (user) router.replace(next());
  }, [user, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await authService.login(values.username, values.password);
      await qc.invalidateQueries({ queryKey: qk.me });
      router.replace(next());
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-teal-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <Smartphone className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Mobile Shop POS</h1>
            <p className="text-sm text-slate-500">Sign in to continue</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="card space-y-4 p-6" noValidate>
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <Field label="Username" htmlFor="username" error={form.formState.errors.username?.message}>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input id="username" className="pl-9" autoComplete="username" autoFocus invalid={!!form.formState.errors.username} {...form.register('username')} />
            </div>
          </Field>
          <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input id="password" type="password" className="pl-9" autoComplete="current-password" invalid={!!form.formState.errors.password} {...form.register('password')} />
            </div>
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
