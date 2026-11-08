'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Monitor, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS, type MeResponse } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/form';
import { Badge, Card, PageHeader, PageLoader } from '@/components/ui/misc';
import { NewPasswordFields } from '@/components/layout/password-form';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

function Profile({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(me.fullName);
  const [title, setTitle] = useState(me.title ?? '');
  const [phone, setPhone] = useState(me.phone ?? '');
  const save = useMutation({
    mutationFn: () => api<MeResponse>('/users/me', { method: 'PATCH', body: { fullName, title, phone } }),
    onSuccess: (u) => (qc.setQueryData(qk.me, u), toast.success('Profile saved')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">Profile</h2>
      <p className="text-sm text-muted">
        {me.email} · {ROLE_LABELS[me.role]}
      </p>
      <Field label="Full name" htmlFor="fn">
        <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title" htmlFor="tt">
          <Input id="tt" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="ph">
          <Input id="ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <Button loading={save.isPending} onClick={() => save.mutate()}>
        Save
      </Button>
    </Card>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const change = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => (toast.success('Password changed. Other devices were signed out.'), setCurrent(''), setKey((k) => k + 1)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">Password</h2>
      <Field label="Current password" htmlFor="cur">
        <PasswordInput id="cur" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <NewPasswordFields key={key} onChange={setNext} />
      <Button disabled={!current || !next} loading={change.isPending} onClick={() => change.mutate()}>
        Change password
      </Button>
    </Card>
  );
}

function TwoFactor({ me, highlight }: { me: MeResponse; highlight: boolean }) {
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ qrDataUrl: string; otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState('');
  const [disableCode, setDisableCode] = useState('');

  const start = useMutation({ mutationFn: () => api<{ qrDataUrl: string; otpauthUri: string; secret: string }>('/auth/2fa/setup', { method: 'POST' }), onSuccess: setSetup, onError: (e) => toast.error(errorMessage(e)) });
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: { totp: code } }),
    onSuccess: (r) => (setCodes(r.recoveryCodes), setSetup(null), void qc.invalidateQueries({ queryKey: qk.me })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => api('/auth/2fa/disable', { method: 'POST', body: { password: disablePw, totp: disableCode } }),
    onSuccess: () => (toast.success('Two-factor authentication turned off'), void qc.invalidateQueries({ queryKey: qk.me })),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className={`space-y-4 p-5 ${highlight && !me.totpEnabled ? 'ring-2 ring-warning' : ''}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        {me.totpEnabled ? <ShieldCheck className="h-5 w-5 text-success" /> : <ShieldAlert className="h-5 w-5 text-warning" />} Two-factor authentication
      </h2>
      {me.mustEnable2fa && <p className="rounded-lg bg-warning/15 p-3 text-sm text-warning">Admins must turn on two-factor authentication before using the gallery.</p>}
      {codes ? (
        <div className="space-y-3">
          <p className="text-sm">Save these recovery codes somewhere safe. Each works once if you lose your phone. They will not be shown again.</p>
          <pre className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-3 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</pre>
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast.success('Copied'))}>
            Copy codes
          </Button>
          <Button onClick={() => setCodes(null)}>I have saved them</Button>
        </div>
      ) : me.totpEnabled ? (
        <>
          <p className="text-sm text-muted">On. You will be asked for a code from your authenticator app when you sign in.</p>
          {!me.permissions.isAdmin && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Turn off</summary>
              <div className="mt-3 space-y-3">
                <PasswordInput placeholder="Password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
                <Input inputMode="numeric" placeholder="6-digit code" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
                <Button variant="danger" size="sm" loading={disable.isPending} onClick={() => disable.mutate()}>
                  Turn off 2FA
                </Button>
              </div>
            </details>
          )}
        </>
      ) : setup ? (
        <div className="space-y-3">
          <p className="text-sm">
            Add WCC Media to an authenticator app (Google Authenticator, Microsoft Authenticator or 1Password), then enter the 6-digit code it shows.
          </p>
          {/* On a phone the QR can't be scanned by the same phone: open the app directly instead. */}
          <a
            href={setup.otpauthUri}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:opacity-90 sm:hidden"
          >
            <ExternalLink className="h-4 w-4" /> Open in authenticator app
          </a>
          <div className="hidden sm:block">
            <p className="mb-2 text-xs text-muted">Scan with your phone:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg bg-white p-2" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted">Or add it by hand: choose “Enter a setup key”, account WCC Media, and paste this key (time-based):</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm tracking-wider">
                {setup.secret.match(/.{1,4}/g)?.join(' ')}
              </code>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Copy setup key"
                onClick={() =>
                  navigator.clipboard.writeText(setup.secret).then(
                    () => toast.success('Key copied'),
                    () => toast.error('Copy failed — select the key and copy it'),
                  )
                }
              >
                <Copy className="h-4 w-4" /> Copy
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-40" />
            <Button loading={enable.isPending} onClick={() => enable.mutate()} disabled={code.length !== 6}>
              Verify & turn on
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">Protect your account with a code from your phone in addition to your password.</p>
          <Button loading={start.isPending} onClick={() => start.mutate()}>
            Set up
          </Button>
        </>
      )}
    </Card>
  );
}

interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function Sessions() {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => api<SessionRow[]>('/auth/sessions') });
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">Signed-in devices</h2>
      {sessions.data?.map((s) => (
        <div key={s.id} className="flex items-center gap-3 text-sm">
          <Monitor className="h-4 w-4 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate">{s.userAgent ?? 'Unknown device'}</p>
            <p className="text-xs text-muted">
              {s.ipAddress} · signed in {formatDateTime(s.createdAt)}
            </p>
          </div>
          {s.current ? (
            <Badge tone="success">This device</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={() => api(`/auth/sessions/${s.id}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: qk.sessions }))}>
              Sign out
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}

function AccountInner() {
  const me = useMe();
  const params = useSearchParams();
  if (!me.data) return <PageLoader />;
  return (
    <>
      <PageHeader title="Account & security" />
      <div className="grid gap-4 lg:grid-cols-2">
        <TwoFactor me={me.data} highlight={params.get('setup2fa') === '1'} />
        <Profile me={me.data} />
        <ChangePassword />
        <Sessions />
      </div>
    </>
  );
}

export default function AccountPage() {
  return (
    <Suspense>
      <AccountInner />
    </Suspense>
  );
}
