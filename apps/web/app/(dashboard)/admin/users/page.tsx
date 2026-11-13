'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS, ROLES, type Role } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, PageHeader, PageLoader } from '@/components/ui/misc';
import { AccessGrid, type GrantRow } from '@/components/layout/access-grid';
import { api, errorMessage } from '@/lib/api';
import { qk, useCategories, useMe } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';
import { useCursorList } from '@/lib/membership';
import { Pager } from '@/components/ui/pager';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  role: Role;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  totpEnabled: boolean;
  lastLoginAt: string | null;
  categoryAccess: GrantRow[];
}
interface InviteRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  invitedBy: { fullName: string };
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe();
  const categories = useCategories();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('PASTOR');
  const [cats, setCats] = useState<string[]>([]);
  const roles = ROLES.filter((r) => me.data?.role === 'SUPER_ADMIN' || r !== 'SUPER_ADMIN');
  const invite = useMutation({
    mutationFn: () => api('/invitations', { method: 'POST', body: { email, role, categoryIds: cats } }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`);
      void qc.invalidateQueries({ queryKey: qk.invitations });
      setEmail('');
      setCats([]);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const contributor = role === 'PASTOR' || role === 'SHEPHERD';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite someone"
      description="They get an email link valid for 72 hours."
      footer={
        <Button loading={invite.isPending} disabled={!email} onClick={() => invite.mutate()}>
          Send invitation
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Email" htmlFor="inv-email">
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="inv-role">
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        {contributor && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Can upload to</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {categories.data?.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={cats.includes(c.id)} onChange={(e) => setCats(e.target.checked ? [...cats, c.id] : cats.filter((x) => x !== c.id))} />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const me = useMe();
  const categories = useCategories();
  const qc = useQueryClient();
  const [role, setRole] = useState<Role | null>(null);
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const r = role ?? user?.role;
  const g = grants ?? user?.categoryAccess ?? [];
  const roles = ROLES.filter((x) => me.data?.role === 'SUPER_ADMIN' || x !== 'SUPER_ADMIN');
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const save = useMutation({
    mutationFn: async () => {
      if (!user) return;
      if (r && r !== user.role) await api(`/users/${user.id}`, { method: 'PATCH', body: { role: r } });
      if (grants) await api(`/users/${user.id}/category-access`, { method: 'PUT', body: { grants } });
    },
    onSuccess: () => (toast.success('Saved'), invalidate(), close()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => (setRole(null), setGrants(null), onClose());
  if (!user) return null;
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => !o && close()}
      wide
      title={user.fullName}
      description={user.email}
      footer={
        <>
          <ConfirmButton
            variant="outline"
            title="Sign this user out everywhere?"
            onConfirm={() => api(`/users/${user.id}/revoke-sessions`, { method: 'POST' }).then(() => toast.success('Signed out of all devices'))}
          >
            Sign out everywhere
          </ConfirmButton>
          <ConfirmButton
            variant={user.status === 'SUSPENDED' ? 'outline' : 'danger'}
            danger={user.status !== 'SUSPENDED'}
            title={user.status === 'SUSPENDED' ? 'Reactivate this user?' : 'Suspend this user?'}
            description={user.status === 'SUSPENDED' ? undefined : 'They are signed out immediately and cannot sign in.'}
            onConfirm={() =>
              api(`/users/${user.id}`, { method: 'PATCH', body: { status: user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' } })
                .then(() => (toast.success(user.status === 'SUSPENDED' ? `${user.fullName} reactivated` : `${user.fullName} suspended`), invalidate(), close()))
                .catch((e) => toast.error(errorMessage(e)))
            }
          >
            {user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
          </ConfirmButton>
          {me.data?.role === 'SUPER_ADMIN' && me.data.id !== user.id && (
            <ConfirmButton
              variant="danger"
              danger
              title={`Delete ${user.fullName}?`}
              description="This permanently removes their account and signs them out. Their events and uploads are kept and moved to you; their share links stop working. This cannot be undone. To block access temporarily, use Suspend instead."
              confirmLabel="Delete user"
              onConfirm={() =>
                api<{ transferredEvents: number; transferredMedia: number }>(`/users/${user.id}`, { method: 'DELETE' })
                  .then((r) => {
                    toast.success(
                      `${user.fullName} deleted` + (r.transferredEvents || r.transferredMedia ? `. ${r.transferredEvents} events and ${r.transferredMedia} files moved to you.` : ''),
                    );
                    invalidate();
                    close();
                  })
                  .catch((e) => toast.error(errorMessage(e)))
              }
            >
              Delete
            </ConfirmButton>
          )}
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Role" htmlFor="ed-role">
          <Select id="ed-role" value={r} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((x) => (
              <option key={x} value={x}>
                {ROLE_LABELS[x]}
              </option>
            ))}
          </Select>
        </Field>
        {categories.data && <AccessGrid categories={categories.data} value={g} onChange={setGrants} />}
        <p className="text-xs text-muted">Admins can do everything regardless of these grants. Everyone can view all folders unless View is unticked.</p>
      </div>
    </Dialog>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const users = useCursorList<UserRow>(qk.users({ q }), '/users', { q: q || undefined });
  const invites = useQuery({ queryKey: qk.invitations, queryFn: () => api<InviteRow[]>('/invitations') });

  return (
    <>
      <PageHeader
        title="Users"
        actions={
          <Button onClick={() => setInviting(true)}>
            <MailPlus className="h-4 w-4" /> Invite
          </Button>
        }
      />
      <Input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-sm" />
      {users.isLoading ? (
        <PageLoader />
      ) : (
        <Card className="divide-y divide-border">
          {users.items.map((u) => (
            <button key={u.id} onClick={() => setEditing(u)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-surface-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand">{u.fullName.slice(0, 1)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {u.title ? `${u.title} ` : ''}
                  {u.fullName}
                </p>
                <p className="truncate text-xs text-muted">
                  {u.email} · last sign-in {formatDateTime(u.lastLoginAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <Badge tone="brand">{ROLE_LABELS[u.role]}</Badge>
                {u.status !== 'ACTIVE' && <Badge tone="danger">{u.status.toLowerCase()}</Badge>}
                {u.totpEnabled && <Badge tone="success">2FA</Badge>}
              </div>
            </button>
          ))}
          <Pager list={users} />
        </Card>
      )}

      {!!invites.data?.length && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Pending invitations</h2>
          <Card className="divide-y divide-border">
            {invites.data.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="text-xs text-muted">
                    {ROLE_LABELS[i.role]} · by {i.invitedBy.fullName} · expires {formatDateTime(i.expiresAt)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" title="Resend" onClick={() => api(`/invitations/${i.id}/resend`, { method: 'POST' }).then(() => (toast.success('Resent'), qc.invalidateQueries({ queryKey: qk.invitations })))}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" title="Revoke" onClick={() =>
                    api(`/invitations/${i.id}`, { method: 'DELETE' }).then(
                      () => (toast.success(`Invitation to ${i.email} revoked`), qc.invalidateQueries({ queryKey: qk.invitations })),
                      (e) => toast.error(errorMessage(e)),
                    )
                  }>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
    </>
  );
}
