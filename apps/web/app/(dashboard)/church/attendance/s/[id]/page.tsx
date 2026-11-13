'use client';

import { isOffline, queueSave } from '@/lib/offline-queue';
import { useMe } from '@/lib/queries';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Lock, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  GUEST_INTENT_LABELS,
  MEETING_TYPE_SUGGESTIONS,
  SERVICE_TYPE_SUGGESTIONS,
  type AttendanceSheetDto,
  type GuestDto,
} from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { MemberFormDialog } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { formatDay, localDate, memberDefaultsFor, mk, sessionName } from '@/lib/membership';
import { cn } from '@/lib/utils';
import { BroughtDialog } from '@/components/church/attendance/brought-dialog';
import { ServiceCounts } from '@/components/church/attendance/service-counts';

export default function SessionSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const key = mk.session(id);
  const sheet = useQuery({
    queryKey: key,
    queryFn: () => api<AttendanceSheetDto>(`/attendance/sessions/${id}`),
  });
  const s = sheet.data;

  // Unsaved tick changes on top of what's saved: refreshing the roster never loses them.
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map());
  const [meta, setMeta] = useState({
    visitors: '0',
    firstTimers: '0',
    notes: '',
    serviceType: '',
    title: '',
    date: '',
  });
  const [q, setQ] = useState('');
  const [con, setCon] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [broughtFor, setBroughtFor] = useState<{ id: string; fullName: string } | null>(null);
  const [convert, setConvert] = useState<GuestDto | null>(null);
  const loadedAt = s?.session.updatedAt;
  useEffect(() => {
    if (!s) return;
    setMeta({
      visitors: String(s.session.visitorCount),
      firstTimers: String(s.session.firstTimerCount),
      notes: s.session.notes ?? '',
      serviceType: s.session.serviceType,
      title: s.session.title ?? '',
      date: s.session.date,
    });
  }, [loadedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useMemo(() => new Set(s?.presentIds ?? []), [s]);
  const isPresent = (mid: string) => changes.get(mid) ?? saved.has(mid);
  const changed = [...changes.entries()].filter(([mid, v]) => v !== saved.has(mid)).map(([mid]) => mid);
  // Which details differ from what's saved (named in the save bar).
  const changedFields = !s
    ? []
    : [
        Number(meta.visitors || 0) !== s.session.visitorCount && 'visitors',
        Number(meta.firstTimers || 0) !== s.session.firstTimerCount && 'first-timers',
        meta.notes.trim() !== (s.session.notes ?? '') && 'notes',
        meta.serviceType.trim() !== s.session.serviceType && 'service',
        meta.title.trim() !== (s.session.title ?? '') && 'title',
        meta.date !== s.session.date && 'date',
      ].filter((x): x is string => !!x);
  const dirty = changed.length > 0 || changedFields.length > 0;
  const unsavedText = [
    ...(changed.length ? [`${changed.length} attendance tick${changed.length === 1 ? '' : 's'}`] : []),
    ...changedFields,
  ];
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const refreshAll = (r: AttendanceSheetDto) => {
    qc.setQueryData(key, r);
    void qc.invalidateQueries({ queryKey: ['attendance', 'summary'] });
    void qc.invalidateQueries({ queryKey: ['attendance', 'sessions'] });
    void qc.invalidateQueries({ queryKey: mk.pendingGuests });
    void qc.invalidateQueries({ queryKey: ['groups'] });
    void qc.invalidateQueries({ queryKey: ['group'] });
  };
  const sheetBody = () => ({
    rosterIds: changed,
    presentIds: changed.filter(isPresent),
    visitorCount: Number(meta.visitors || 0),
    firstTimerCount: Math.min(Number(meta.firstTimers || 0), Number(meta.visitors || 0)),
    notes: meta.notes || null,
    serviceType: meta.serviceType.trim() || undefined,
    title: meta.title.trim() || null,
    date: meta.date || undefined,
  });
  const save = useMutation({
    mutationFn: (body: ReturnType<typeof sheetBody>) =>
      api<AttendanceSheetDto>(`/attendance/sessions/${id}`, { method: 'PUT', body }),
    // Try even when offline, so a failed save can be kept on the phone (instead of React Query pausing it).
    networkMode: 'always',
    onSuccess: (r) => {
      setChanges(new Map());
      refreshAll(r);
      toast.success(`Saved: ${r.presentIds.length} present`);
      // Done: go back to where they came from instead of showing the same sheet again.
      router.push(r.session.group ? `/church/groups/${r.session.group.id}` : '/church/attendance');
    },
    onError: (e, body) => {
      if (!isOffline(e) || !me.data || !s) return toast.error(errorMessage(e));
      queueSave({
        userId: me.data.id,
        path: `/attendance/sessions/${id}`,
        method: 'PUT',
        body,
        label: `${s.session.group?.name ?? s.session.serviceType} ${s.session.date}`,
      });
      setChanges(new Map());
      // Stay here: other pages may not load without signal.
      toast.success(
        'No signal: saved on this phone. It will be sent automatically when you’re back online.',
        { duration: 8000 },
      );
    },
  });

  if (sheet.isLoading) return <PageLoader />;
  if (!s)
    return (
      <EmptyState title="Couldn’t open this attendance sheet">
        {sheet.error ? errorMessage(sheet.error) : null}
      </EmptyState>
    );
  if (s.session.kind === 'CHURCH_SERVICE') return <ServiceCounts sheet={s} onSaved={refreshAll} />;
  const term = q.trim().toLowerCase();
  const constituencies = [
    ...new Map(
      s.roster.filter((m) => m.constituencyId).map((m) => [m.constituencyId!, m.constituency!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const teams = [...new Map(s.roster.flatMap((m) => m.teamRoles).map((r) => [r.id, r.name])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const shown = s.roster.filter(
    (m) =>
      (!con || (con === 'none' ? !m.constituencyId : m.constituencyId === con)) &&
      (!teamFilter || m.teamRoles.some((r) => r.id === teamFilter)) &&
      (!term ||
        m.fullName.toLowerCase().includes(term) ||
        m.churchRole.toLowerCase().includes(term) ||
        m.teamRoles.some((r) => r.name.toLowerCase().includes(term))),
  );
  const presentCount = s.roster.filter((m) => isPresent(m.id)).length;
  const checkedIn = s.checkedIn ?? {};
  const selfCount = Object.keys(checkedIn).filter((mid) => isPresent(mid)).length;
  const toggle = (mid: string) => {
    if (!s.canEdit) return;
    // They checked themselves in with the QR code at the service: confirm before unticking.
    if (
      checkedIn[mid] &&
      isPresent(mid) &&
      !window.confirm('This member checked themselves in at the service with the QR code. Untick anyway?')
    )
      return;
    setChanges((c) => new Map(c).set(mid, !isPresent(mid)));
  };
  const markShown = (on: boolean) =>
    setChanges((c) => {
      const n = new Map(c);
      for (const m of shown) n.set(m.id, on);
      return n;
    });
  const back = s.session.group ? `/church/groups/${s.session.group.id}` : '/church/attendance';
  const suggestions = s.session.group ? MEETING_TYPE_SUGGESTIONS : SERVICE_TYPE_SUGGESTIONS;
  const broughtTotal = Object.values(s.brought).reduce((a, n) => a + n, 0);

  return (
    <div className="pb-24">
      <PageHeader title={sessionName(s.session)} subtitle={formatDay(s.session.date)}>
        <Link href={back} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </PageHeader>

      {s.canEdit ? (
        <Card className="mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 [&>*]:min-w-0">
          <Field label="What is it?" htmlFor="sh-type">
            <Input
              id="sh-type"
              list="sh-types"
              maxLength={40}
              value={meta.serviceType}
              onChange={(e) => setMeta({ ...meta, serviceType: e.target.value })}
            />
            <datalist id="sh-types">
              {suggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Title" htmlFor="sh-title">
            <Input
              id="sh-title"
              maxLength={120}
              placeholder="Optional"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </Field>
          <Field label="Date" htmlFor="sh-date">
            <Input
              id="sh-date"
              type="date"
              max={localDate()}
              value={meta.date}
              onChange={(e) => e.target.value && setMeta({ ...meta, date: e.target.value })}
            />
          </Field>
          <Field label="Visitors" htmlFor="sh-vis" hint="Not on the member list">
            <Input
              id="sh-vis"
              type="number"
              inputMode="numeric"
              min={0}
              value={meta.visitors}
              onChange={(e) => setMeta({ ...meta, visitors: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
          <Field label="First-timers" htmlFor="sh-ft" hint="Of the visitors">
            <Input
              id="sh-ft"
              type="number"
              inputMode="numeric"
              min={0}
              value={meta.firstTimers}
              onChange={(e) => setMeta({ ...meta, firstTimers: e.target.value.replace(/\D/g, '') })}
            />
          </Field>
        </Card>
      ) : (
        <>
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">
            <Lock className="h-4 w-4 shrink-0" /> You can view this sheet. Only{' '}
            {s.session.group ? 'this group’s leaders' : 'pastors'} or a Super Admin can change it.
          </p>
          <p className="mb-4 text-sm">
            {s.session.visitorCount} visitors · {s.session.firstTimerCount} first-timers
          </p>
        </>
      )}
      {s.session.recordedBy && (
        <p className="mb-3 text-xs text-muted">
          Last saved by {s.session.recordedBy} on {new Date(s.session.updatedAt).toLocaleString()}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="space-y-2 border-b border-border p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem] [&>*]:min-w-0">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                className="pl-9"
                placeholder="Find a member…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            {teams.length > 0 && (
              <Select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label="Team">
                <option value="">All teams</option>
                {teams.map(([tid, name]) => (
                  <option key={tid} value={tid}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
            {!s.session.group && constituencies.length > 0 && (
              <Select value={con} onChange={(e) => setCon(e.target.value)} aria-label="Constituency">
                <option value="">All constituencies</option>
                {constituencies.map(([cid, name]) => (
                  <option key={cid} value={cid}>
                    {name}
                  </option>
                ))}
                <option value="none">No constituency</option>
              </Select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="mr-auto text-muted">
              <b className="text-fg">{presentCount}</b> of {s.roster.length} present
              {selfCount > 0 && ` · ${selfCount} checked in themselves`}
              {broughtTotal > 0 && ` · ${broughtTotal} brought`}
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
              const on = isPresent(m.id);
              const b = s.brought[m.id];
              return (
                <li key={m.id} className={cn('flex min-w-0 items-center', on && 'bg-brand/5')}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!s.canEdit}
                    onClick={() => toggle(m.id)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors',
                      s.canEdit && 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2',
                        on ? 'border-brand bg-brand text-white' : 'border-border',
                      )}
                    >
                      {on && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium">{m.fullName}</span>
                        {checkedIn[m.id] && (
                          <span
                            className="shrink-0 rounded-full bg-success/15 px-1.5 text-[10px] font-medium text-success"
                            title={`Checked in at ${new Date(checkedIn[m.id]!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                          >
                            Checked in
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {m.teamRoles.length ? m.teamRoles.map((r) => r.name).join(', ') : m.churchRole}
                        {!s.session.group || s.session.group.type === 'BACENTA'
                          ? ` · ${m.constituency ?? 'No constituency'}`
                          : ''}
                      </span>
                    </span>
                  </button>
                  {on && (s.canEdit || b !== undefined) && (
                    <button
                      type="button"
                      disabled={!s.canEdit}
                      onClick={() => setBroughtFor(m)}
                      className={cn(
                        'mr-3 flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                        b === undefined
                          ? 'border-dashed border-border text-muted hover:text-fg'
                          : b > 0
                            ? 'border-brand/40 bg-brand/10 text-brand'
                            : 'border-border text-muted',
                      )}
                      aria-label={`People ${m.fullName} brought`}
                    >
                      <Users className="h-3.5 w-3.5" />
                      {b === undefined ? 'Brought?' : b > 0 ? `+${b}` : 'None'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="p-6 text-center text-sm text-muted">
            {s.roster.length
              ? 'No members match.'
              : s.session.group
                ? 'This group has no members yet. Add members from the group page.'
                : 'No members yet. Add members first.'}
          </p>
        )}
      </Card>

      {s.guests.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="mb-2 font-semibold">People brought ({s.guests.length})</h2>
          <ul className="divide-y divide-border text-sm">
            {s.guests.map((g) => (
              <li key={g.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.fullName || 'Name not recorded'}</p>
                  <p className="truncate text-xs text-muted">
                    Brought by {g.broughtBy?.fullName ?? 'a former member'}
                    {g.phone ? ` · ${g.phone}` : ''}
                  </p>
                </div>
                {g.convertedMember ? (
                  <Link href={`/church/members/${g.convertedMember.id}`}>
                    <Badge tone="success">Now a member</Badge>
                  </Link>
                ) : (
                  <Badge tone={g.intent === 'JOINING' ? 'brand' : 'neutral'}>
                    {GUEST_INTENT_LABELS[g.intent]}
                  </Badge>
                )}
                {s.canEdit && !g.convertedMember && (
                  <Button
                    size="sm"
                    variant={g.intent === 'JOINING' ? 'primary' : 'outline'}
                    onClick={() => setConvert(g)}
                  >
                    Make member
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.canEdit && (
        <Card className="mt-4 p-4">
          <Field label="Notes (optional)" htmlFor="sh-notes" hint="Leave blank if there’s nothing to add.">
            <Textarea
              id="sh-notes"
              maxLength={1000}
              value={meta.notes}
              onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
              className="min-h-16"
              placeholder="e.g. Rain kept numbers down"
            />
          </Field>
        </Card>
      )}

      {s.canEdit && (
        <div className="mt-6">
          <ConfirmButton
            variant="ghost"
            danger
            className="text-danger"
            title="Delete this attendance record?"
            description={`Removes attendance and people brought for ${sessionName(s.session)} on ${formatDay(s.session.date)}, for everyone. This cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={async () => {
              try {
                await api(`/attendance/sessions/${id}`, { method: 'DELETE' });
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

      {s.canEdit && (
        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="mx-auto flex max-w-[1600px] items-center gap-3 lg:pl-64">
            <p className="min-w-0 flex-1 truncate text-sm text-muted">
              {dirty ? `Not saved yet: ${unsavedText.join(', ')}` : 'All changes saved'}
            </p>
            <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(sheetBody())}>
              Save attendance
            </Button>
          </div>
        </div>
      )}

      <BroughtDialog
        member={broughtFor}
        sheet={s}
        onClose={() => setBroughtFor(null)}
        onSaved={(r) => {
          // The server marked them present; drop any local "absent" for them.
          setChanges((c) => {
            const n = new Map(c);
            if (broughtFor) n.delete(broughtFor.id);
            return n;
          });
          refreshAll(r);
        }}
      />
      <MemberFormDialog
        open={adding}
        onOpenChange={setAdding}
        defaults={memberDefaultsFor(s.session.group)}
        onSaved={async (m) => {
          const fresh = await api<AttendanceSheetDto>(`/attendance/sessions/${id}`);
          qc.setQueryData(key, fresh);
          setChanges((c) => new Map(c).set(m.id, true));
        }}
      />
      <MemberFormDialog
        open={!!convert}
        onOpenChange={(o) => !o && setConvert(null)}
        defaults={
          convert
            ? {
                fullName: convert.fullName ?? '',
                phone: convert.phone ?? '',
                fromGuestId: convert.id,
                title: 'Make a member',
                ...memberDefaultsFor(s.session.group),
              }
            : undefined
        }
        onSaved={async () => refreshAll(await api<AttendanceSheetDto>(`/attendance/sessions/${id}`))}
      />
    </div>
  );
}
