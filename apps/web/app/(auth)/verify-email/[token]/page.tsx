'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; email: string } | { kind: 'error'; message: string };

export default function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const qc = useQueryClient();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const started = useRef(false);

  async function verify() {
    setState({ kind: 'busy' });
    try {
      const r = await api<{ email: string }>('/auth/verify-email', { method: 'POST', body: { token }, anonymous: true });
      qc.clear(); // every session was signed out
      setState({ kind: 'done', email: r.email });
      toast.success('Email address confirmed');
    } catch (err) {
      const message = errorMessage(err);
      setState({ kind: 'error', message });
      toast.error(message);
    }
  }

  useEffect(() => {
    // Once only (Strict Mode runs effects twice; the token is single-use).
    if (started.current) return;
    started.current = true;
    void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Confirm email address</h1>
      {state.kind === 'done' ? (
        <div className="space-y-4 text-sm">
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <span>
              Your email is now <span className="font-medium">{state.email}</span>. You were signed out everywhere, so sign in again with the new address.
            </span>
          </p>
          <Link href="/login" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 font-medium text-white hover:opacity-90">
            Sign in
          </Link>
        </div>
      ) : state.kind === 'error' ? (
        <div className="space-y-4 text-sm">
          <p className="flex items-start gap-2">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <span>{state.message}. Request a new link from Account &amp; security.</span>
          </p>
          <Link className="text-brand hover:underline" href="/account">
            Go to Account &amp; security
          </Link>
        </div>
      ) : (
        <div className="space-y-4 text-sm text-muted">
          <p>Confirming your new email address…</p>
          <Button loading disabled>
            Confirming
          </Button>
        </div>
      )}
    </Card>
  );
}
