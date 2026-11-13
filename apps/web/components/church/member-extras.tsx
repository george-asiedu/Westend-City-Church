'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Link from 'next/link';
import { Award, KeyRound, Plus, Send, Users, X } from 'lucide-react';
import { MILESTONE_TYPES, type MilestoneDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { ResetPasswordButton } from '@/components/layout/reset-password';
import { formatDay, localDate, mk, type MemberDetail } from '@/lib/membership';

/** Salvation, baptism, foundation school… with dates. */
export function MilestonesCard({ memberId, canEdit }: { memberId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['milestones', memberId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<MilestoneDto[]>(`/members/${memberId}/milestones`),
  });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ type: MILESTONE_TYPES[0] as string, other: '', date: localDate(), note: '' });
  const add = useMutation({
    mutationFn: () =>
      api<MilestoneDto[]>(`/members/${memberId}/milestones`, {
        method: 'POST',
        body: { type: f.type === 'Other' ? f.other : f.type, date: f.date, note: f.note || null },
      }),
    onSuccess: (rows) => (qc.setQueryData(key, rows), setOpen(false), toast.success('Added')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/members/${memberId}/milestones/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 font-semibold">
          <Award className="h-4 w-4" /> Milestones
        </h2>
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => (
              setF({ type: MILESTONE_TYPES[0], other: '', date: localDate(), note: '' }),
              setOpen(true)
            )}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>
      {q.data?.length ? (
        <ul className="divide-y divide-border text-sm">
          {q.data.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{m.type}</span>{' '}
                <span className="text-muted">· {formatDay(m.date)}</span>
                {m.note && <span className="block text-xs text-muted">{m.note}</span>}
              </span>
              {canEdit && (
                <button
                  className="rounded p-1 text-muted hover:text-danger"
                  aria-label={`Remove ${m.type}`}
                  onClick={() => remove.mutate(m.id)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{q.isLoading ? 'Loading…' : 'None recorded yet.'}</p>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a milestone"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={add.isPending}
              disabled={!f.date || (f.type === 'Other' && f.other.trim().length < 2)}
              onClick={() => add.mutate()}
            >
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="What" htmlFor="ms-type">
            <Select id="ms-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {[...MILESTONE_TYPES, 'Other'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          {f.type === 'Other' && (
            <Field label="Name it" htmlFor="ms-other">
              <Input
                id="ms-other"
                maxLength={60}
                value={f.other}
                onChange={(e) => setF({ ...f, other: e.target.value })}
              />
            </Field>
          )}
          <Field label="When" htmlFor="ms-date">
            <Input
              id="ms-date"
              type="date"
              max={localDate()}
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </Field>
          <Field label="Note (optional)" htmlFor="ms-note">
            <Input
              id="ms-note"
              maxLength={300}
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

/** Whether the member can sign in to the app, and an invite button for leaders. */
export function AppAccessCard({ d }: { d: MemberDetail }) {
  const qc = useQueryClient();
  const isAdmin = !!useMe().data?.permissions.canManageMembership;
  const invite = useMutation({
    mutationFn: () => api(`/members/${d.id}/invite`, { method: 'POST' }),
    onSuccess: () => (
      toast.success(`Invitation emailed to ${d.email}`),
      qc.invalidateQueries({ queryKey: mk.member(d.id) })
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="space-y-2 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4" /> App account
      </h2>
      {d.account ? (
        <>
          <p className="text-sm">
            <Badge tone="success">Has an account</Badge>{' '}
            <span className="text-muted">
              {d.account.lastLoginAt
                ? `last signed in ${formatDay(d.account.lastLoginAt.slice(0, 10))}`
                : 'not signed in yet'}
              {d.account.twoFactor ? ' · two-step sign-in on' : ''}
              {d.account.mustChangePassword ? ' · has a temporary password' : ''}
            </span>
          </p>
          {isAdmin && <ResetPasswordButton userId={d.account.id} name={d.fullName} />}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            With an account, {d.fullName.split(' ')[0]} can see announcements, the calendar, their groups and
            leaders, rota duties and their own attendance. They can’t see other members’ details.
          </p>
          {d.invitedAt && (
            <p className="text-sm">
              Invited {formatDay(d.invitedAt.slice(0, 10))}; waiting for them to accept.
            </p>
          )}
          {d.canEdit &&
            (d.email ? (
              <Button size="sm" variant="outline" loading={invite.isPending} onClick={() => invite.mutate()}>
                <Send className="h-4 w-4" />{' '}
                {d.invitedAt ? 'Send the invitation again' : `Invite to the app (${d.email})`}
              </Button>
            ) : (
              <p className="text-xs text-muted">Add an email address to invite them.</p>
            ))}
        </>
      )}
    </Card>
  );
}

interface Household {
  guardian: { id: string; fullName: string; phone: string | null } | null;
  dependants: Array<{ id: string; fullName: string; phone: string | null }>;
}

/** "Checks in with": children and members without a phone are checked in by a parent or relative at the QR code. */
export function HouseholdCard({
  memberId,
  name,
  canEdit,
}: {
  memberId: string;
  name: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const key = ['household', memberId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Household>(`/members/${memberId}/household`) });
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState('');
  const search = useQuery({
    queryKey: ['household-search', term],
    queryFn: () =>
      api<{ items: Array<{ id: string; fullName: string; phone: string | null }> }>('/members', {
        query: { q: term, limit: 8 },
      }),
    enabled: picking && term.trim().length >= 2,
  });
  const set = useMutation({
    mutationFn: (guardianId: string | null) =>
      api<Household>(`/members/${memberId}/guardian`, { method: 'PUT', body: { guardianId } }),
    onSuccess: (h) => (qc.setQueryData(key, h), setPicking(false), setTerm(''), toast.success('Saved')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const h = q.data;
  return (
    <Card className="space-y-2 p-4" data-household>
      <h2 className="flex items-center gap-2 font-semibold">
        <Users className="h-4 w-4" /> Check-in household
      </h2>
      <p className="text-xs text-muted">
        For children and members without a phone: whoever they come with checks them in at the service QR
        code.
      </p>
      <div className="text-sm">
        <span className="text-muted">Checks in with: </span>
        {h?.guardian ? (
          <>
            <Link
              className="font-medium text-brand hover:underline"
              href={`/church/members/${h.guardian.id}`}
            >
              {h.guardian.fullName}
            </Link>
            {canEdit && (
              <button className="ml-2 text-xs text-muted hover:text-danger" onClick={() => set.mutate(null)}>
                Remove
              </button>
            )}
          </>
        ) : (
          <span>themselves</span>
        )}
      </div>
      {!!h?.dependants.length && (
        <p className="text-sm">
          <span className="text-muted">Checks in: </span>
          {h.dependants.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link className="text-brand hover:underline" href={`/church/members/${d.id}`}>
                {d.fullName}
              </Link>
            </span>
          ))}
        </p>
      )}
      {canEdit &&
        (picking ? (
          <div className="space-y-1">
            <Input
              autoFocus
              placeholder={`Who does ${name.split(' ')[0]} come with? Search…`}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {(search.data?.items ?? [])
              .filter((m) => m.id !== memberId)
              .map((m) => (
                <button
                  key={m.id}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  onClick={() => set.mutate(m.id)}
                >
                  {m.fullName} <span className="text-muted">{m.phone ?? ''}</span>
                </button>
              ))}
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            {h?.guardian ? 'Change' : 'Set who they come with'}
          </Button>
        ))}
    </Card>
  );
}
