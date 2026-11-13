'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MailCheck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

/** Someone scanned a QR invite: they give their email and we send them their own invitation link. */
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const info = useQuery({ queryKey: ['join', code], queryFn: () => api<{ label: string; roleLabel: string; needsApproval: boolean }>(`/public/join/${encodeURIComponent(code)}`), retry: false });
  const [f, setF] = useState({ fullName: '', email: '' });
  const send = useMutation({ mutationFn: () => api<{ needsApproval: boolean }>(`/public/join/${encodeURIComponent(code)}`, { method: 'POST', body: f }) });

  if (info.isLoading) return <PageLoader />;
  if (info.error)
    return (
      <Card className="space-y-3 p-6 text-center">
        <p className="font-semibold">This QR code isn’t working</p>
        <p className="text-sm text-muted">{errorMessage(info.error)}</p>
        <Link href="/login" className="text-sm text-brand hover:underline">
          Already have an account? Sign in
        </Link>
      </Card>
    );
  if (send.isSuccess)
    return (
      <Card className="space-y-3 p-6 text-center" data-join-done>
        <MailCheck className="mx-auto h-10 w-10 text-success" />
        <h1 className="text-lg font-semibold">{send.data.needsApproval ? 'Thanks! Your request is in.' : 'Check your email'}</h1>
        <p className="text-sm text-muted">
          {send.data.needsApproval
            ? `A church admin will confirm you as a ${info.data!.roleLabel.toLowerCase()}. Then you’ll get an email at ${f.email} with a link to set your password.`
            : `We’ve sent a link to ${f.email}. Open it on this phone to set your password and you’re in. It can take a minute; check spam too.`}
        </p>
      </Card>
    );

  return (
    <Card className="p-5">
      <h1 className="mb-1 text-lg font-semibold">Join the WCC app</h1>
      <p className="mb-4 text-sm text-muted">
        You’re joining as a <b>{info.data!.roleLabel}</b>. Announcements, events, your groups and more, all in one place.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label="Your name" htmlFor="j-name">
          <Input id="j-name" required minLength={2} maxLength={120} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="j-email" hint="We’ll send your sign-in link here.">
          <Input id="j-email" type="email" required maxLength={254} autoComplete="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        {send.error && <p className="text-sm text-danger">{errorMessage(send.error)}</p>}
        <Button type="submit" className="w-full" loading={send.isPending}>
          Continue
        </Button>
        <p className="flex items-center justify-center gap-1 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5" /> Your email is only used for your account.
        </p>
        <p className="text-center text-sm">
          <Link href="/login" className="text-brand hover:underline">
            Already have an account? Sign in
          </Link>
        </p>
      </form>
    </Card>
  );
}
