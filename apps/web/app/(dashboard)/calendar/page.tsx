'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, MapPin, Plus, Trash2, Users } from 'lucide-react';
import type { ChurchEventDto, RsvpStatus } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { Pager } from '@/components/ui/pager';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { canAddMembers, useCursorList, useGroups } from '@/lib/membership';
import { cn } from '@/lib/utils';

const RSVP: Array<[RsvpStatus, string]> = [
  ['GOING', 'Going'],
  ['MAYBE', 'Maybe'],
  ['NOT_GOING', 'Can’t go'],
];

function dateRange(e: ChurchEventDto) {
  const s = new Date(e.startsAt);
  const day = s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (!e.endsAt) return `${day}, ${time(s)}`;
  const end = new Date(e.endsAt);
  return end.toDateString() === s.toDateString() ? `${day}, ${time(s)}–${time(end)}` : `${day} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

export default function CalendarPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [open, setOpen] = useState(false);
  const list = useCursorList<ChurchEventDto>(['church-events', when], '/church-events', { when }, !!me.data);
  const refresh = () => qc.invalidateQueries({ queryKey: ['church-events'] });
  const rsvp = useMutation({
    mutationFn: (v: { id: string; status: RsvpStatus; guests?: number }) => api<ChurchEventDto>(`/church-events/${v.id}/rsvp`, { method: 'PUT', body: { status: v.status, guests: v.guests ?? 0 } }),
    onSuccess: () => (toast.success('Thanks, saved'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/church-events/${id}`, { method: 'DELETE' }),
    onSuccess: () => (toast.success('Deleted'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (me.isLoading) return <PageLoader />;
  const leader = !!me.data && canAddMembers(me.data);

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Church and group events. Let the organisers know if you’re coming."
        actions={
          leader && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Add event
            </Button>
          )
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-border p-0.5 text-sm">
        {(['upcoming', 'past'] as const).map((t) => (
          <button key={t} onClick={() => setWhen(t)} aria-pressed={when === t} className={cn('rounded-md px-3 py-1', when === t ? 'bg-brand text-white' : 'text-muted hover:text-fg')}>
            {t === 'upcoming' ? 'Coming up' : 'Past'}
          </button>
        ))}
      </div>
      {list.isLoading ? (
        <PageLoader />
      ) : list.error ? (
        <EmptyState title="Couldn’t load events">{errorMessage(list.error)}</EmptyState>
      ) : !list.items.length ? (
        <EmptyState icon={<CalendarDays className="h-8 w-8" />} title={when === 'upcoming' ? 'Nothing planned yet' : 'No past events'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.items.map((e) => {
            const full = !!e.capacity && e.counts.people >= e.capacity && e.myRsvp?.status !== 'GOING';
            return (
              <Card key={e.id} className="min-w-0 space-y-2 p-4" data-event>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words font-semibold normal-case">{e.title}</h2>
                    <p className="text-sm text-muted">{dateRange(e)}</p>
                  </div>
                  {e.group ? <Badge>{e.group.name}</Badge> : <Badge tone="brand">Whole church</Badge>}
                </div>
                {e.location && (
                  <p className="flex items-center gap-1 text-sm">
                    <MapPin className="h-4 w-4 shrink-0 text-muted" /> {e.location}
                  </p>
                )}
                {e.description && <p className="whitespace-pre-line break-words text-sm">{e.description}</p>}
                {e.rsvpEnabled && (
                  <>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      <Users className="h-3.5 w-3.5" /> {e.counts.going} going{e.counts.people > e.counts.going ? ` (${e.counts.people} people with guests)` : ''} · {e.counts.maybe} maybe
                      {e.capacity ? ` · ${Math.max(0, e.capacity - e.counts.people)} of ${e.capacity} places left` : ''}
                    </p>
                    {when === 'upcoming' && (
                      <div className="flex flex-wrap gap-1.5">
                        {RSVP.map(([s, label]) => (
                          <Button
                            key={s}
                            size="sm"
                            variant={e.myRsvp?.status === s ? 'primary' : 'outline'}
                            aria-pressed={e.myRsvp?.status === s}
                            disabled={rsvp.isPending || (s === 'GOING' && full)}
                            onClick={() => rsvp.mutate({ id: e.id, status: s, guests: e.myRsvp?.guests })}
                          >
                            {label}
                          </Button>
                        ))}
                        {e.myRsvp?.status === 'GOING' && (
                          <Select
                            aria-label="Bringing guests"
                            className="h-8 w-auto"
                            value={e.myRsvp.guests}
                            onChange={(x) => rsvp.mutate({ id: e.id, status: 'GOING', guests: Number(x.target.value) })}
                          >
                            {[0, 1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n ? `+${n} guest${n === 1 ? '' : 's'}` : 'Just me'}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    )}
                  </>
                )}
                {e.canEdit && (
                  <div className="flex justify-end">
                    <ConfirmButton size="sm" variant="ghost" className="h-7 px-2" danger title={`Delete “${e.title}”?`} description="Its RSVPs are deleted too." confirmLabel="Delete" onConfirm={() => del.mutateAsync(e.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </ConfirmButton>
                  </div>
                )}
              </Card>
            );
          })}
          <Pager list={list} className="lg:col-span-2" />
        </div>
      )}
      {leader && <EventDialog open={open} onOpenChange={setOpen} admin={!!me.data?.permissions.canManageMembership} onSaved={refresh} />}
    </>
  );
}

function EventDialog({ open, onOpenChange, admin, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; admin: boolean; onSaved: () => void }) {
  const groups = useGroups();
  const blank = { title: '', description: '', location: '', startsAt: '', endsAt: '', groupId: '', rsvpEnabled: true, capacity: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const mine = (groups.data ?? []).filter((g) => admin || g.canManage);
  useEffect(() => {
    if (open && !admin && !f.groupId && mine[0]) setF((x) => ({ ...x, groupId: mine[0]!.id }));
  }, [open, admin, f.groupId, mine]);
  const save = useMutation({
    mutationFn: () =>
      api('/church-events', {
        method: 'POST',
        body: {
          title: f.title,
          description: f.description || null,
          location: f.location || null,
          startsAt: new Date(f.startsAt).toISOString(),
          endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
          groupId: f.groupId || null,
          rsvpEnabled: f.rsvpEnabled,
          capacity: f.capacity ? Number(f.capacity) : null,
        },
      }),
    onSuccess: () => (toast.success('Event added'), onOpenChange(false), onSaved()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add event"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={f.title.trim().length < 2 || !f.startsAt || (!admin && !f.groupId)} onClick={() => save.mutate()}>
            Add event
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" htmlFor="ev-title">
          <Input id="ev-title" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Starts" htmlFor="ev-start">
            <Input id="ev-start" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
          </Field>
          <Field label="Ends (optional)" htmlFor="ev-end">
            <Input id="ev-end" type="datetime-local" min={f.startsAt} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
          </Field>
        </div>
        <Field label="Where" htmlFor="ev-loc">
          <Input id="ev-loc" maxLength={200} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label="Details" htmlFor="ev-desc">
          <Textarea id="ev-desc" rows={3} maxLength={3000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="For" htmlFor="ev-group">
          <Select id="ev-group" value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}>
            {admin && <option value="">The whole church</option>}
            {mine.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox label="Ask people to RSVP" checked={f.rsvpEnabled} onChange={(e) => setF({ ...f, rsvpEnabled: e.target.checked })} />
        {f.rsvpEnabled && (
          <Field label="Places (optional)" htmlFor="ev-cap" hint="Leave empty for no limit">
            <Input id="ev-cap" type="number" min={1} inputMode="numeric" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
