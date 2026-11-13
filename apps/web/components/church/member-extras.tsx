'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, KeyRound, Plus, Send, X } from 'lucide-react';
import { MILESTONE_TYPES, type MilestoneDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { formatDay, localDate, mk, type MemberDetail } from '@/lib/membership';

/** Salvation, baptism, foundation school… with dates. */
export function MilestonesCard({ memberId, canEdit }: { memberId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['milestones', memberId];
  const q = useQuery({ queryKey: key, queryFn: () => api<MilestoneDto[]>(`/members/${memberId}/milestones`) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ type: MILESTONE_TYPES[0] as string, other: '', date: localDate(), note: '' });
  const add = useMutation({
    mutationFn: () => api<MilestoneDto[]>(`/members/${memberId}/milestones`, { method: 'POST', body: { type: f.type === 'Other' ? f.other : f.type, date: f.date, note: f.note || null } }),
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
          <Button size="sm" variant="outline" onClick={() => (setF({ type: MILESTONE_TYPES[0], other: '', date: localDate(), note: '' }), setOpen(true))}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>
      {q.data?.length ? (
        <ul className="divide-y divide-border text-sm">
          {q.data.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{m.type}</span> <span className="text-muted">· {formatDay(m.date)}</span>
                {m.note && <span className="block text-xs text-muted">{m.note}</span>}
              </span>
              {canEdit && (
                <button className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${m.type}`} onClick={() => remove.mutate(m.id)}>
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
            <Button loading={add.isPending} disabled={!f.date || (f.type === 'Other' && f.other.trim().length < 2)} onClick={() => add.mutate()}>
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
              <Input id="ms-other" maxLength={60} value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} />
            </Field>
          )}
          <Field label="When" htmlFor="ms-date">
            <Input id="ms-date" type="date" max={localDate()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Note (optional)" htmlFor="ms-note">
            <Input id="ms-note" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

/** Whether the member can sign in to the app, and an invite button for leaders. */
export function AppAccessCard({ d }: { d: MemberDetail }) {
  const qc = useQueryClient();
  const invite = useMutation({
    mutationFn: () => api(`/members/${d.id}/invite`, { method: 'POST' }),
    onSuccess: () => (toast.success(`Invitation emailed to ${d.email}`), qc.invalidateQueries({ queryKey: mk.member(d.id) })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="space-y-2 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4" /> App account
      </h2>
      {d.account ? (
        <p className="text-sm">
          <Badge tone="success">Has an account</Badge>{' '}
          <span className="text-muted">
            {d.account.lastLoginAt ? `last signed in ${formatDay(d.account.lastLoginAt.slice(0, 10))}` : 'not signed in yet'}
            {d.account.twoFactor ? ' · two-step sign-in on' : ''}
          </span>
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">
            With an account, {d.fullName.split(' ')[0]} can see announcements, the calendar, their groups and leaders, rota duties and their own attendance. They can’t see other members’
            details.
          </p>
          {d.invitedAt && <p className="text-sm">Invited {formatDay(d.invitedAt.slice(0, 10))}; waiting for them to accept.</p>}
          {d.canEdit &&
            (d.email ? (
              <Button size="sm" variant="outline" loading={invite.isPending} onClick={() => invite.mutate()}>
                <Send className="h-4 w-4" /> {d.invitedAt ? 'Send the invitation again' : `Invite to the app (${d.email})`}
              </Button>
            ) : (
              <p className="text-xs text-muted">Add an email address to invite them.</p>
            ))}
        </>
      )}
    </Card>
  );
}
