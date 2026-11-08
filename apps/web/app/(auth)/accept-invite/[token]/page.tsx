'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type Role } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { NewPasswordFields } from '@/components/layout/password-form';
import { api, errorMessage } from '@/lib/api';

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api<{ email: string; role: Role }>(`/invitations/verify/${encodeURIComponent(token)}`, { anonymous: true }), retry: false });
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (invite.isLoading) return <PageLoader />;
  if (invite.isError)
    return (
      <Card className="p-6">
        <h1 className="mb-2 text-xl font-semibold">Invitation unavailable</h1>
        <p className="text-sm text-muted">{errorMessage(invite.error)}</p>
      </Card>
    );

  if (done)
    return (
      <Card className="p-6">
        <h1 className="mb-2 text-xl font-semibold">Welcome!</h1>
        <p className="mb-4 text-sm text-muted">Your account is ready.</p>
        <Link href="/login">
          <Button className="w-full justify-center">Sign in</Button>
        </Link>
      </Card>
    );

  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">Accept your invitation</h1>
      <p className="mb-6 text-sm text-muted">
        {invite.data?.email} · {invite.data ? ROLE_LABELS[invite.data.role] : ''}
      </p>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!password) return;
          setBusy(true);
          setError(null);
          try {
            await api('/invitations/accept', { method: 'POST', anonymous: true, body: { token, fullName, title: title || undefined, phone: phone || undefined, password } });
            setDone(true);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Full name" htmlFor="name">
          <Input id="name" required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title (optional)" htmlFor="title">
            <Input id="title" placeholder="Pastor, Rev., Bro." maxLength={40} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone">
            <Input id="phone" type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <NewPasswordFields onChange={setPassword} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={!password || fullName.trim().length < 2} loading={busy} className="w-full justify-center">
          Create account
        </Button>
      </form>
    </Card>
  );
}
