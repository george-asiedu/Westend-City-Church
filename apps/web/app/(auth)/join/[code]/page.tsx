'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Clock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, EMAIL_PATTERN, Field, Input, PasswordInput, PhoneInput, Select } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

interface Info {
  label: string;
  roleLabel: string;
  needsApproval: boolean;
  basontas: Array<{ id: string; name: string; constituency: string | null }>;
  bacentas: Array<{ id: string; name: string }>;
}

/** Someone scanned a QR join code: they create their account here, in one go. */
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const path = `/public/join/${encodeURIComponent(code)}`;
  const info = useQuery({ queryKey: ['join', code], queryFn: () => api<Info>(path, { anonymous: true }), retry: false });
  const [f, setF] = useState({ fullName: '', title: '', email: '', phone: '', password: '', basontaId: '', bacentaIds: [] as string[] });
  const [showBacentas, setShowBacentas] = useState(false);
  const basonta = useMemo(() => info.data?.basontas.find((b) => b.id === f.basontaId), [info.data, f.basontaId]);
  const send = useMutation({
    mutationFn: async () => {
      const r = await api<{ status: 'ACTIVE' | 'PENDING_APPROVAL' }>(path, {
        method: 'POST',
        anonymous: true,
        body: { ...f, title: f.title || undefined, email: f.email.trim() || null, basontaId: f.basontaId || null },
      });
      // Members are in straight away: sign them in.
      if (r.status === 'ACTIVE') {
        await api('/auth/login', { method: 'POST', anonymous: true, body: { email: f.phone, password: f.password } });
        window.location.assign('/me/church');
      }
      return r;
    },
  });

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
  const d = info.data!;
  if (send.data?.status === 'PENDING_APPROVAL')
    return (
      <Card className="space-y-3 p-6 text-center" data-join-done>
        <Clock className="mx-auto h-10 w-10 text-brand" />
        <h1 className="text-lg font-semibold">Thanks, {f.fullName.split(' ')[0]}! Almost there.</h1>
        <p className="text-sm text-muted">
          Your {d.roleLabel.toLowerCase()} account is created. A Super Admin will approve it shortly, and you can then sign in with your phone number and the password you just chose{f.email ? ` (we’ll email ${f.email} too)` : ''}.
        </p>
      </Card>
    );

  return (
    <Card className="p-5">
      <h1 className="mb-1 text-lg font-semibold">Join The WCC App</h1>
      <p className="mb-4 text-sm text-muted">
        Create your account as a <b>{d.roleLabel}</b>
        {d.needsApproval ? '. A Super Admin approves it before you can sign in.' : '. You’ll be signed in straight away.'}
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        {d.needsApproval && (
          <Field label="Title (optional)" htmlFor="j-title" hint="e.g. Rev., Pastor, Elder">
            <Input id="j-title" maxLength={40} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
        )}
        <Field label="Full name" htmlFor="j-name">
          <Input id="j-name" required minLength={2} maxLength={120} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <Field label="Phone number" htmlFor="j-phone" hint="10 digits. You’ll sign in with it, and use it to check in at church.">
          <PhoneInput id="j-phone" required value={f.phone} onValueChange={(phone) => setF({ ...f, phone })} />
        </Field>
        <Field label="Email (optional)" htmlFor="j-email" hint="Lets you reset your password if you forget it.">
          <Input id="j-email" type="email" pattern={EMAIL_PATTERN} maxLength={254} autoComplete="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Password" htmlFor="j-pw" hint="At least 8 characters. Avoid common words.">
          <PasswordInput id="j-pw" required minLength={8} maxLength={200} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Your basonta (optional)" htmlFor="j-basonta" hint={basonta?.constituency ? `Constituency: ${basonta.constituency}` : undefined}>
          <Select id="j-basonta" value={f.basontaId} onChange={(e) => setF({ ...f, basontaId: e.target.value })}>
            <option value="">I don’t know / none</option>
            {d.basontas.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.constituency ? ` (${b.constituency})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {d.bacentas.length > 0 && (
          <div className="space-y-1">
            <Checkbox label="I serve in a bacenta (ministry)" checked={showBacentas} onChange={(e) => (setShowBacentas(e.target.checked), !e.target.checked && setF({ ...f, bacentaIds: [] }))} />
            {showBacentas && (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {d.bacentas.map((b) => (
                  <Checkbox
                    key={b.id}
                    label={b.name}
                    checked={f.bacentaIds.includes(b.id)}
                    onChange={(e) => setF({ ...f, bacentaIds: e.target.checked ? [...f.bacentaIds, b.id] : f.bacentaIds.filter((x) => x !== b.id) })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {send.error && <p className="text-sm text-danger">{errorMessage(send.error)}</p>}
        <Button type="submit" className="w-full" loading={send.isPending}>
          Create my account
        </Button>
        <p className="flex items-center justify-center gap-1 text-xs text-muted">
          <ShieldCheck className="h-3.5 w-3.5" /> Your details are only shared with your church leaders.
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
