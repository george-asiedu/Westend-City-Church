'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Lock, Search, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { AttendanceSheetDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { MemberFormDialog } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { formatDay, localDate, mk } from '@/lib/membership';
import { cn } from '@/lib/utils';

function Sheet() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const kind = (params.get('kind') === 'GROUP_MEETING' ? 'GROUP_MEETING' : 'SUNDAY_SERVICE') as AttendanceSheetDto['kind'];
  const groupId = params.get('groupId') ?? undefined;
  const date = params.get('date') || localDate();
  const key = mk.sheet({ kind, groupId, date });
  const sheet = useQuery({ queryKey: key, queryFn: () => api<AttendanceSheetDto>('/attendance/sheet', { query: { kind, groupId, date } }) });

  const [present, setPresent] = useState<Set<string>>(new Set());
  const [visitors, setVisitors] = useState('0');
  const [firstTimers, setFirstTimers] = useState('0');
  const [notes, setNotes] = useState('');
  const [q, setQ] = useState('');
  const [con, setCon] = useState('');
  const [adding, setAdding] = useState(false);

  // Reset local ticks only when a different sheet loads or after a save, not when the
  // roster refreshes (e.g. after adding a new member mid-way).
  const loaded = sheet.data;
  const resetKey = loaded ? `${loaded.kind}|${loaded.group?.id ?? ''}|${loaded.date}|${loaded.session?.updatedAt ?? 'new'}` : '';
  useEffect(() => {
    if (!loaded) return;
    setPresent(new Set(loaded.presentIds));
    setVisitors(String(loaded.session?.visitorCount ?? 0));
    setFirstTimers(String(loaded.session?.firstTimerCount ?? 0));
    setNotes(loaded.session?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const original = useMemo(() => new Set(loaded?.presentIds ?? []), [loaded]);
  const changed = useMemo(() => {
    if (!loaded) return [] as string[];
    return loaded.roster.map((m) => m.id).filter((id) => original.has(id) !== present.has(id));
  }, [loaded, original, present]);
  const countsChanged =
    !!loaded &&
    (Number(visitors || 0) !== (loaded.session?.visitorCount ?? 0) ||
      Number(firstTimers || 0) !== (loaded.session?.firstTimerCount ?? 0) ||
      notes !== (loaded.session?.notes ?? ''));
  const dirty = changed.length > 0 || countsChanged;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    // Only the members whose tick changed are sent, so two people marking different
    // parts of the same Sunday never overwrite each other.
    mutationFn: () =>
      api<AttendanceSheetDto>('/attendance/sheet', {
        method: 'PUT',
        body: {
          kind,
          groupId: groupId ?? null,
          date,
          rosterIds: changed,
          presentIds: changed.filter((id) => present.has(id)),
          visitorCount: Number(visitors || 0),
          firstTimerCount: Number(firstTimers || 0),
          notes: notes || null,
        },
      }),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      void qc.invalidateQueries({ queryKey: ['attendance', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['attendance', 'sessions'] });
      void qc.invalidateQueries({ queryKey: ['groups'] });
      toast.success(`Saved: ${r.presentIds.length} present on ${formatDay(r.date)}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const changeDate = (d: string) => {
    if (!d) return;
    if (dirty && !window.confirm('You have unsaved changes. Switch date and lose them?')) return;
    const sp = new URLSearchParams(params.toString());
    sp.set('date', d);
    router.replace(`/church/attendance/take?${sp.toString()}`);
  };

  if (sheet.isLoading) return <PageLoader />;
  if (!loaded) return <EmptyState title="Couldn’t open this attendance sheet">{sheet.error ? errorMessage(sheet.error) : null}</EmptyState>;
  const s = loaded;
  const term = q.trim().toLowerCase();
  const constituencies = [...new Map(s.roster.filter((m) => m.constituencyId).map((m) => [m.constituencyId!, m.constituency!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = s.roster.filter((m) => (!con || (con === 'none' ? !m.constituencyId : m.constituencyId === con)) && (!term || m.fullName.toLowerCase().includes(term) || m.churchRole.toLowerCase().includes(term)));
  const toggle = (id: string) =>
    s.canEdit &&
    setPresent((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const markShown = (on: boolean) =>
    setPresent((p) => {
      const n = new Set(p);
      for (const m of shown) on ? n.add(m.id) : n.delete(m.id);
      return n;
    });
  const title = s.kind === 'SUNDAY_SERVICE' ? 'Sunday service' : s.group?.name ?? 'Meeting';
  const back = s.group ? `/church/groups/${s.group.id}` : '/church/attendance';

  return (
    <div className="pb-24">
      <PageHeader title={title} subtitle={`Attendance for ${formatDay(date)}`}>
        <Link href={back} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </PageHeader>

      <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Date" htmlFor="sh-date">
          <Input id="sh-date" type="date" max={localDate()} value={date} onChange={(e) => changeDate(e.target.value)} />
        </Field>
        <Field label="Visitors" htmlFor="sh-vis" hint="People who aren’t on the member list">
          <Input id="sh-vis" type="number" inputMode="numeric" min={0} value={visitors} disabled={!s.canEdit} onChange={(e) => setVisitors(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="First-timers" htmlFor="sh-ft" hint="Of the visitors, how many came for the first time">
          <Input id="sh-ft" type="number" inputMode="numeric" min={0} value={firstTimers} disabled={!s.canEdit} onChange={(e) => setFirstTimers(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </Card>

      {!s.canEdit && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">
          <Lock className="h-4 w-4 shrink-0" /> You can view this sheet. Only {s.kind === 'SUNDAY_SERVICE' ? 'pastors and Super Admins' : 'this group’s pastor or a Super Admin'} can change it.
        </p>
      )}
      {s.session?.recordedBy && (
        <p className="mb-3 text-xs text-muted">
          Last saved by {s.session.recordedBy} on {new Date(s.session.updatedAt).toLocaleString()}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="space-y-2 border-b border-border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem] [&>*]:min-w-0">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input className="pl-9" placeholder="Find a member…" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            {s.kind === 'SUNDAY_SERVICE' && constituencies.length > 0 && (
              <Select value={con} onChange={(e) => setCon(e.target.value)} aria-label="Constituency">
                <option value="">All constituencies</option>
                {constituencies.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                <option value="none">No constituency</option>
              </Select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="mr-auto text-muted">
              <b className="text-fg">{present.size}</b> of {s.roster.length} present
              {shown.length !== s.roster.length && ` · showing ${shown.length}`}
            </span>
            {s.canEdit && (
              <>
                <Button size="sm" variant="ghost" onClick={() => markShown(true)} disabled={!shown.length}>
                  Mark {shown.length === s.roster.length ? 'all' : 'shown'} present
                </Button>
                <Button size="sm" variant="ghost" onClick={() => markShown(false)} disabled={!shown.length}>
                  Clear
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <UserPlus className="h-4 w-4" /> New member
                </Button>
              </>
            )}
          </div>
        </div>
        {shown.length ? (
          <ul className="divide-y divide-border">
            {shown.map((m) => {
              const on = present.has(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!s.canEdit}
                    onClick={() => toggle(m.id)}
                    className={cn('flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors', s.canEdit && 'hover:bg-surface-2', on && 'bg-brand/5')}
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-brand bg-brand text-white' : 'border-border')}>
                      {on && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.fullName}</span>
                      <span className="block truncate text-xs text-muted">
                        {m.churchRole}
                        {s.kind === 'SUNDAY_SERVICE' || s.group?.type === 'BASONTA' ? ` · ${m.constituency ?? 'No constituency'}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-6 text-center text-sm text-muted">
            {s.roster.length ? 'No members match.' : s.group ? 'This group has no members yet. Add members from the group page.' : 'No members yet. Add members first.'}
          </p>
        )}
      </Card>

      {s.canEdit && (
        <Card className="mt-4 p-4">
          <Field label="Notes" htmlFor="sh-notes">
            <Textarea id="sh-notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" placeholder="Optional" />
          </Field>
        </Card>
      )}

      {s.canEdit && s.session && (
        <div className="mt-6">
          <ConfirmButton
            variant="ghost"
            danger
            className="text-danger"
            title="Delete this attendance record?"
            description={`Removes attendance for ${title} on ${formatDay(date)}, for everyone. This cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={async () => {
              try {
                await api(`/attendance/sessions/${s.session!.id}`, { method: 'DELETE' });
                toast.success('Attendance record deleted');
                void qc.invalidateQueries({ queryKey: ['attendance'] });
                void qc.invalidateQueries({ queryKey: ['groups'] });
                router.replace(back);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete this record
          </ConfirmButton>
        </div>
      )}

      {/* Sticky save bar above the phone bottom navigation. */}
      {s.canEdit && (
        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 lg:pl-64">
            <p className="min-w-0 flex-1 truncate text-sm text-muted">
              {dirty ? `${changed.length} change${changed.length === 1 ? '' : 's'} not saved` : s.session ? 'All changes saved' : 'Not recorded yet'}
            </p>
            <Button loading={save.isPending} disabled={!dirty && !!s.session} onClick={() => save.mutate()}>
              Save attendance
            </Button>
          </div>
        </div>
      )}

      <MemberFormDialog
        open={adding}
        onOpenChange={setAdding}
        defaults={s.group ? (s.group.type === 'CONSTITUENCY' ? { constituencyId: s.group.id } : { basontaIds: [s.group.id] }) : undefined}
        onSaved={async (m) => {
          // Reload the roster, keep current ticks, and tick the new member.
          const fresh = await api<AttendanceSheetDto>('/attendance/sheet', { query: { kind, groupId, date } });
          qc.setQueryData(key, fresh);
          setPresent((p) => new Set([...p, m.id]));
        }}
      />
    </div>
  );
}

export default function TakeAttendancePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Sheet />
    </Suspense>
  );
}
