'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Megaphone, Pin, Plus, Trash2 } from 'lucide-react';
import type { AnnouncementAudience, AnnouncementDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { Pager } from '@/components/ui/pager';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { canAddMembers, useCursorList, useGroups } from '@/lib/membership';
import { cn } from '@/lib/utils';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const AUDIENCE: Record<AnnouncementAudience, string> = { CHURCH: 'Whole church', LEADERS: 'All leaders', GROUPS: 'Groups' };

export default function AnnouncementsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'feed' | 'manage'>('feed');
  const [open, setOpen] = useState(false);
  const leader = !!me.data && canAddMembers(me.data);
  const list = useCursorList<AnnouncementDto>(['announcements', tab], '/announcements', { manage: tab === 'manage' || undefined }, !!me.data);
  // Opening the feed marks what's on screen as read.
  useEffect(() => {
    if (tab !== 'feed') return;
    const unread = list.items.filter((a) => !a.read);
    if (!unread.length) return;
    void Promise.all(unread.map((a) => api(`/announcements/${a.id}/read`, { method: 'POST' }).catch(() => undefined))).then(() => qc.invalidateQueries({ queryKey: ['announcements', 'unread'] }));
  }, [tab, list.items, qc]);
  const del = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => (toast.success('Deleted'), qc.invalidateQueries({ queryKey: ['announcements'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (me.isLoading) return <PageLoader />;

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="News and notices from the church and your groups."
        actions={
          leader && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New announcement
            </Button>
          )
        }
      />
      {leader && (
        <div className="mb-4 inline-flex rounded-lg border border-border p-0.5 text-sm">
          {(['feed', 'manage'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cn('rounded-md px-3 py-1', tab === t ? 'bg-brand text-white' : 'text-muted hover:text-fg')}>
              {t === 'feed' ? 'Feed' : 'Sent by me'}
            </button>
          ))}
        </div>
      )}
      {list.isLoading ? (
        <PageLoader />
      ) : list.error ? (
        <EmptyState title="Couldn’t load announcements">{errorMessage(list.error)}</EmptyState>
      ) : !list.items.length ? (
        <EmptyState icon={<Megaphone className="h-8 w-8" />} title={tab === 'feed' ? 'No announcements right now' : 'You haven’t sent any announcements'} />
      ) : (
        <div className="max-w-3xl space-y-3">
          {list.items.map((a) => {
            const scheduled = Date.parse(a.publishAt) > Date.now();
            const expired = !!a.expiresAt && Date.parse(a.expiresAt) <= Date.now();
            return (
              <Card key={a.id} className={cn('space-y-2 p-4', a.pinned && 'border-brand/40')} data-announcement>
                <div className="flex flex-wrap items-center gap-2">
                  {a.pinned && <Pin className="h-4 w-4 text-brand" aria-label="Pinned" />}
                  <h2 className="mr-auto min-w-0 break-words font-semibold normal-case">{a.title}</h2>
                  {tab === 'feed' && !a.read && <Badge tone="brand">New</Badge>}
                  {scheduled && <Badge tone="warning">Scheduled {when(a.publishAt)}</Badge>}
                  {expired && <Badge>Ended</Badge>}
                </div>
                <p className="whitespace-pre-line break-words text-sm">{a.body}</p>
                {a.linkUrl && (
                  <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
                    Open link <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    {a.createdBy ?? 'Church'} · {when(a.publishAt)}
                  </span>
                  <span>
                    To: {a.audience === 'GROUPS' ? a.groups.map((g) => g.name).join(', ') : AUDIENCE[a.audience]}
                  </span>
                  {a.seen && (
                    <span>
                      Seen by {a.seen.by} of {a.seen.of}
                    </span>
                  )}
                  {a.canEdit && (
                    <ConfirmButton size="sm" variant="ghost" className="ml-auto h-7 px-2" danger title="Delete this announcement?" confirmLabel="Delete" onConfirm={() => del.mutateAsync(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </ConfirmButton>
                  )}
                </div>
              </Card>
            );
          })}
          <Pager list={list} />
        </div>
      )}
      {leader && <ComposeDialog open={open} onOpenChange={setOpen} admin={!!me.data?.permissions.canManageMembership} onSent={() => (setTab('manage'), qc.invalidateQueries({ queryKey: ['announcements'] }))} />}
    </>
  );
}

function ComposeDialog({ open, onOpenChange, admin, onSent }: { open: boolean; onOpenChange: (o: boolean) => void; admin: boolean; onSent: () => void }) {
  const groups = useGroups();
  const blank = { title: '', body: '', linkUrl: '', audience: (admin ? 'CHURCH' : 'GROUPS') as AnnouncementAudience, groupIds: [] as string[], pinned: false, publishAt: '', expiresAt: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const mine = (groups.data ?? []).filter((g) => admin || g.canAdminister);
  const send = useMutation({
    mutationFn: () =>
      api('/announcements', {
        method: 'POST',
        body: {
          title: f.title,
          body: f.body,
          linkUrl: f.linkUrl || null,
          audience: f.audience,
          groupIds: f.audience === 'GROUPS' ? f.groupIds : [],
          pinned: f.pinned,
          publishAt: f.publishAt ? new Date(f.publishAt).toISOString() : null,
          expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
        },
      }),
    onSuccess: () => {
      toast.success(f.publishAt && Date.parse(f.publishAt) > Date.now() ? 'Scheduled' : 'Sent. People with notifications on will get it now.');
      onOpenChange(false);
      onSent();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New announcement"
      description="It shows in everyone’s Announcements and is sent as a notification."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={send.isPending} disabled={f.title.trim().length < 2 || !f.body.trim() || (f.audience === 'GROUPS' && !f.groupIds.length)} onClick={() => send.mutate()}>
            {f.publishAt && Date.parse(f.publishAt) > Date.now() ? 'Schedule' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" htmlFor="ann-title">
          <Input id="ann-title" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Message" htmlFor="ann-body">
          <Textarea id="ann-body" rows={5} maxLength={5000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <Field label="Link (optional)" htmlFor="ann-link">
          <Input id="ann-link" type="url" placeholder="https://" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} />
        </Field>
        <Field label="Who is it for?" htmlFor="ann-aud">
          <Select id="ann-aud" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as AnnouncementAudience })}>
            {admin && <option value="CHURCH">Whole church</option>}
            {admin && <option value="LEADERS">All pastors and shepherds</option>}
            <option value="GROUPS">{admin ? 'Particular groups' : 'My groups'}</option>
          </Select>
        </Field>
        {f.audience === 'GROUPS' && (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {mine.length ? (
              mine.map((g) => (
                <Checkbox
                  key={g.id}
                  label={g.name}
                  checked={f.groupIds.includes(g.id)}
                  onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })}
                />
              ))
            ) : (
              <p className="text-sm text-muted">You don’t lead any groups.</p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Send at (optional)" htmlFor="ann-at" hint="Leave empty to send now">
            <Input id="ann-at" type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} />
          </Field>
          <Field label="Take down at (optional)" htmlFor="ann-end">
            <Input id="ann-end" type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
          </Field>
        </div>
        {admin && <Checkbox label="Pin to the top" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} />}
      </div>
    </Dialog>
  );
}
