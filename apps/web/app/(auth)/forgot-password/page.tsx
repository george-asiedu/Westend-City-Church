'use client';

import { toast } from 'sonner';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">Reset your password</h1>
      {sent ? (
        <p className="text-sm text-muted">If an account exists for {email}, we have emailed a reset link. It expires in 30 minutes.</p>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await api('/auth/forgot-password', { method: 'POST', body: { email }, anonymous: true });
              setSent(true);
              toast.success('If that email has an account, a reset link is on its way.');
            } catch (err) {
              setError(errorMessage(err));
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" loading={busy} className="w-full justify-center">
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className="text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
