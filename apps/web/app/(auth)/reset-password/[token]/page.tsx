'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { NewPasswordFields } from '@/components/layout/password-form';
import { api, errorMessage } from '@/lib/api';

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [password, setPassword] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
      {done ? (
        <p className="text-sm">
          Password changed. All devices were signed out.{' '}
          <Link className="text-brand hover:underline" href="/login">
            Sign in
          </Link>
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!password) return;
            setBusy(true);
            setError(null);
            try {
              await api('/auth/reset-password', { method: 'POST', body: { token, password }, anonymous: true });
              setDone(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <NewPasswordFields onChange={setPassword} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={!password} loading={busy} className="w-full justify-center">
            Set password
          </Button>
        </form>
      )}
    </Card>
  );
}
