'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeartHandshake, MessageCircle, Phone } from 'lucide-react';
import { FOLLOW_UP_STATUS_LABELS, type FollowUpDto, type FollowUpStatus } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { Pager } from '@/components/ui/pager';
import { ChurchTabs } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { canAddMembers, formatDay, useCursorList, whatsappLink } from '@/lib/membership';
import { useAssignees } from '@/components/church/follow-up';
import { cn } from '@/lib/utils';

const TONE: Record<FollowUpStatus, 'neutral' | 'brand' | 'success' | 'warning' | 'danger'> = { OPEN: 'brand', CONTACTED: 'neutral', VISITED: 'success', UNREACHABLE: 'warning', DONE: 'success' };

export default function FollowUpsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [editing, setEditing] = useState<FollowUpDto | null>(null);
  const ok = !!me.data && canAddMembers(me.data);
  const list = useCursorList<FollowUpDto>(['follow-ups', scope, state], '/follow-ups', { scope, state }, ok);
  if (me.isLoading) return <PageLoader />;
  if (!ok) return <EmptyState title="Follow-ups are for pastors, shepherds and Super Admins" />;
  const overdue = list.first?.overdue as number | undefined;

  return (
    <>
      <PageHeader title="Church" subtitle="People to call or visit: absentees, new people and anyone who needs care." />
      <ChurchTabs />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-auto" aria-label="Whose" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="mine">Assigned to me</option>
          <option value="all">{me.data?.permissions.canManageMembership ? 'Everyone’s' : 'Mine and ones I created'}</option>
        </Select>
        <Select className="w-auto" aria-label="Status" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          <option value="open">Still to do</option>
          <option value="closed">Done</option>
        </Select>
        {!!overdue && state === 'open' && <Badge tone="danger">{overdue} overdue</Badge>}
        <p className="ml-auto text-xs text-muted">Start one from a member’s page, a new person, or the attendance sheet.</p>
      </div>
      {list.isLoading ? (
        <PageLoader />
      ) : list.error ? (
        <EmptyState title="Couldn’t load follow-ups">{errorMessage(list.error)}</EmptyState>
      ) : !list.items.length ? (
        <EmptyState icon={<HeartHandshake className="h-8 w-8" />} title={state === 'open' ? 'Nobody to follow up right now' : 'Nothing finished yet'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.items.map((f) => (
            <Card key={f.id} className={cn('min-w-0 space-y-2 p-4', f.overdue && 'border-danger/50')} data-follow-up>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {f.person.kind === 'MEMBER' ? (
                    <Link href={`/church/members/${f.person.id}`} className="font-semibold hover:text-brand">
                      {f.person.fullName}
                    </Link>
                  ) : (
                    <p className="font-semibold">{f.person.fullName}</p>
                  )}
                  <p className="text-xs text-muted">{f.person.kind === 'GUEST' ? 'New person' : f.person.group ?? 'Member'}</p>
                </div>
                <Badge tone={TONE[f.status]}>{FOLLOW_UP_STATUS_LABELS[f.status]}</Badge>
              </div>
              <p className="break-words text-sm">{f.reason}</p>
              <p className="text-xs text-muted">
                {f.assignedTo ? `For ${f.assignedTo.fullName}` : 'Not assigned'}
                {f.dueOn && <span className={cn(f.overdue && 'font-medium text-danger')}> · due {formatDay(f.dueOn)}</span>}
                {f.createdBy && ` · from ${f.createdBy.fullName}`}
              </p>
              {f.notes[0] && (
                <p className="rounded-lg bg-surface-2 p-2 text-xs">
                  <b>{f.notes[0].author ?? 'Someone'}:</b> {f.notes[0].text}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {f.person.phone && (
                  <>
                    <a href={`tel:${f.person.phone}`}>
                      <Button size="sm" variant="outline">
                        <Phone className="h-3.5 w-3.5" /> Call
                      </Button>
                    </a>
                    <a href={whatsappLink(f.person.phone)} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline">
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </Button>
                    </a>
                  </>
                )}
                {f.canEdit && (
                  <Button size="sm" className="ml-auto" onClick={() => setEditing(f)}>
                    Update
                  </Button>
                )}
              </div>
            </Card>
          ))}
          <Pager list={list} className="lg:col-span-2" />
        </div>
      )}
      <UpdateDialog f={editing} onClose={() => setEditing(null)} onSaved={() => qc.invalidateQueries({ queryKey: ['follow-ups'] })} />
    </>
  );
}

function UpdateDialog({ f, onClose, onSaved }: { f: FollowUpDto | null; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<FollowUpStatus | ''>('');
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const people = useAssignees(!!f);
  const save = useMutation({
    mutationFn: () =>
      api(`/follow-ups/${f!.id}`, {
        method: 'PATCH',
        body: { status: status || undefined, note: note || undefined, assignedToId: assignee && assignee !== f!.assignedTo?.id ? assignee : undefined },
      }),
    onSuccess: () => (toast.success('Saved'), setStatus(''), setNote(''), setAssignee(''), onClose(), onSaved()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={!!f}
      onOpenChange={(o) => !o && onClose()}
      title={f ? `Follow up: ${f.person.fullName}` : ''}
      description={f?.reason}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!status && !note.trim() && !assignee} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      {f && (
        <div className="space-y-3">
          <Field label="How did it go?" htmlFor="fu-status">
            <Select id="fu-status" value={status || f.status} onChange={(e) => setStatus(e.target.value as FollowUpStatus)}>
              {(Object.keys(FOLLOW_UP_STATUS_LABELS) as FollowUpStatus[]).map((s) => (
                <option key={s} value={s}>
                  {FOLLOW_UP_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" htmlFor="fu-note">
            <Textarea id="fu-note" rows={3} maxLength={1000} placeholder="e.g. Called, she’s been travelling. Back next week." value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Assigned to" htmlFor="fu-who">
            <Select id="fu-who" value={assignee || f.assignedTo?.id || ''} onChange={(e) => setAssignee(e.target.value)}>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title ? `${p.title} ` : ''}
                  {p.fullName}
                </option>
              ))}
            </Select>
          </Field>
          {f.notes.length > 0 && (
            <div className="space-y-1 border-t border-border pt-3 text-xs">
              {f.notes.map((n) => (
                <p key={n.id}>
                  <span className="text-muted">{new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> <b>{n.author}</b>
                  {n.status && ` (${FOLLOW_UP_STATUS_LABELS[n.status]})`}: {n.text}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

