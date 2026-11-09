'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import type { MeResponse } from '@wcc/shared';

function safeNext(next: string | null): string {
  // Only same-site relative paths: no open redirects.
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.get('signedOut') === '1') {
      toast.success('You have been signed out');
      router.replace('/login'); // drop the flag so a refresh doesn't repeat it
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: MeResponse }>('/auth/login', { method: 'POST', body: { email, password, totp: needTotp ? totp.trim() : undefined } });
      qc.setQueryData(qk.me, res.user);
      toast.success(`Welcome back, ${res.user.fullName.split(' ')[0]}`);
      if (res.user.mustEnable2fa) toast.info('Set up two-factor authentication to continue.');
      router.replace(res.user.mustEnable2fa ? '/account?setup2fa=1' : safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setNeedTotp(true);
        toast.info('Enter the 6-digit code from your authenticator app.');
      } else {
        const msg = err instanceof Error ? err.message : 'Sign-in failed';
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-muted">Invite-only access for the church media team and pastors.</p>
      <form onSubmit={submit} className="space-y-4">
        {!needTotp ? (
          <>
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password">
              <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Authentication code" htmlFor="totp" hint="The 6-digit code from your authenticator app, or a recovery code.">
            <Input id="totp" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={totp} onChange={(e) => setTotp(e.target.value)} />
          </Field>
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" className="w-full justify-center" loading={busy}>
          {needTotp ? 'Verify' : 'Sign in'}
        </Button>
      </form>
      <div className="mt-4 text-center text-sm">
        <Link href="/forgot-password" className="text-brand hover:underline">
          Forgot password?
        </Link>
      </div>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
