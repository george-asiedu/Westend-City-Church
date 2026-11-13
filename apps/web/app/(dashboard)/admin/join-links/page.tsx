'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Plus, QrCode, X } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { QrCard, useOrigin } from '@/components/ui/qr-card';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { formatDay } from '@/lib/membership';

interface JoinLink {
  id: string;
  code: string;
  label: string;
  role: Role;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
  createdBy: string | null;
}
interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  needsApproval: boolean;
  joinLink: { id: string; label: string } | null;
}

const ROLES: Array<Exclude<Role, 'SUPER_ADMIN'>> = ['VIEWER', 'SHEPHERD', 'PASTOR'];
const WHO: Record<string, string> = { VIEWER: 'church members', SHEPHERD: 'shepherds', PASTOR: 'pastors' };

export default function JoinLinksPage() {
  const me = useMe();
  const qc = useQueryClient();
  const origin = useOrigin();
  const ok = !!me.data?.permissions.isAdmin;
  const links = useQuery({ queryKey: ['join-links'], queryFn: () => api<JoinLink[]>('/join-links'), enabled: ok });
  const invites = useQuery({ queryKey: ['invitations'], queryFn: () => api<PendingInvite[]>('/invitations'), enabled: ok });
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<JoinLink | null>(null);
  const refresh = () => (qc.invalidateQueries({ queryKey: ['join-links'] }), qc.invalidateQueries({ queryKey: ['invitations'] }));
  const approve = useMutation({
    mutationFn: (id: string) => api(`/invitations/${id}/approve`, { method: 'POST' }),
    onSuccess: () => (toast.success('Approved: the invitation email is on its way'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/invitations/${id}`, { method: 'DELETE' }),
    onSuccess: () => (toast.success('Declined'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (me.isLoading) return <PageLoader />;
  if (!ok) return <EmptyState title="Only Super Admins can make QR invites" />;
  const waiting = (invites.data ?? []).filter((i) => i.needsApproval);

  return (
    <>
      <PageHeader
        title="QR invites"
        subtitle="Print or share one QR code to invite many people at once. They scan it, enter their email, and get their own invitation link."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New QR invite
          </Button>
        }
      />
      {waiting.length > 0 && (
        <Card className="mb-4 space-y-2 border-warning/50 p-4" data-approvals>
          <h2 className="font-semibold">Waiting for your approval ({waiting.length})</h2>
          <p className="text-xs text-muted">Pastor and shepherd requests from a QR code need a Super Admin’s OK before the invitation email is sent.</p>
          <ul className="divide-y divide-border text-sm">
            {waiting.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 break-all">
                  <b>{i.email}</b>{' '}
                  <span className="text-muted">
                    · {ROLE_LABELS[i.role]} · {i.joinLink?.label ?? 'QR invite'} · {formatDay(i.createdAt.slice(0, 10))}
                  </span>
                </span>
                <Button size="sm" loading={approve.isPending && approve.variables === i.id} onClick={() => approve.mutate(i.id)}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button size="sm" variant="ghost" loading={decline.isPending && decline.variables === i.id} onClick={() => decline.mutate(i.id)}>
                  <X className="h-4 w-4" /> Decline
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {links.isLoading ? (
        <PageLoader />
      ) : !links.data?.length ? (
        <EmptyState icon={<QrCode className="h-8 w-8" />} title="No QR invites yet">
          Make one for each group you invite, e.g. “Members, November” or “New shepherds”.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {links.data.map((l) => (
            <Card key={l.id} className="min-w-0 space-y-2 p-4" data-join-link>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.label}</p>
                  <p className="text-xs text-muted">
                    Joins as {ROLE_LABELS[l.role]} · {l.uses}
                    {l.maxUses ? ` of ${l.maxUses}` : ''} used
                    {l.expiresAt ? ` · until ${formatDay(l.expiresAt.slice(0, 10))}` : ''}
                  </p>
                </div>
                <Badge tone={l.active ? 'success' : 'neutral'}>{l.active ? 'Active' : 'Stopped'}</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!l.active} onClick={() => setShowing(l)}>
                  <QrCode className="h-4 w-4" /> Show QR code
                </Button>
                {l.active && (
                  <ConfirmButton size="sm" variant="ghost" danger title={`Stop “${l.label}”?`} description="The QR code stops working. People who already asked still get their invitation." confirmLabel="Stop it" onConfirm={() => api(`/join-links/${l.id}`, { method: 'DELETE' }).then(refresh)}>
                    Stop
                  </ConfirmButton>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!showing} onOpenChange={(o) => !o && setShowing(null)} title={showing?.label ?? ''} description="Download it to share on WhatsApp, or print it for the church.">
        {showing && origin && (
          <QrCard
            url={`${origin}/join/${showing.code}`}
            title={`Join the WCC app`}
            subtitle={`For ${WHO[showing.role]}. Scan, enter your email, and we’ll send you a link to finish.`}
            steps={['Open your phone camera and point it here', 'Enter your name and email', 'Open the email and set your password']}
            filename={`wcc-join-${showing.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          />
        )}
      </Dialog>
      <CreateDialog open={creating} onOpenChange={setCreating} onCreated={(l) => (refresh(), setShowing(l))} />
    </>
  );
}

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (l: JoinLink) => void }) {
  const [f, setF] = useState({ label: '', role: 'VIEWER' as Role, maxUses: '', days: '30' });
  const save = useMutation({
    mutationFn: () => api<JoinLink>('/join-links', { method: 'POST', body: { label: f.label, role: f.role, maxUses: f.maxUses ? Number(f.maxUses) : null, expiresInDays: f.days ? Number(f.days) : null } }),
    onSuccess: (l) => (onOpenChange(false), setF({ label: '', role: 'VIEWER', maxUses: '', days: '30' }), onCreated(l)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New QR invite"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={f.label.trim().length < 2} onClick={() => save.mutate()}>
            Make QR code
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name it" htmlFor="jl-label" hint="Only you see this, e.g. “Members, Sunday 23 Nov”">
          <Input id="jl-label" maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <Field label="They join as" htmlFor="jl-role" hint={f.role === 'VIEWER' ? 'Their invitation email goes out straight away.' : 'You approve each person before their invitation email goes out.'}>
          <Select id="jl-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stop after (people)" htmlFor="jl-max" hint="Empty = no limit">
            <Input id="jl-max" type="number" min={1} inputMode="numeric" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} />
          </Field>
          <Field label="Works for (days)" htmlFor="jl-days" hint="Empty = until you stop it">
            <Input id="jl-days" type="number" min={1} max={365} inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
