'use client';

import { SelfCheckinCard } from '@/components/church/self-checkin';
import { isOffline, queueSave } from '@/lib/offline-queue';
import { useMe } from '@/lib/queries';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Lock, Minus, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { GUEST_INTENT_LABELS, MEETING_TYPE_SUGGESTIONS, SERVICE_TYPE_SUGGESTIONS, SUNDAY_SERVICE_TITLES, isPerServiceType, type AttendanceSheetDto, type GuestDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { MemberFormDialog } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { formatDay, localDate, memberDefaultsFor, mk, sessionName } from '@/lib/membership';
import { cn } from '@/lib/utils';

type GuestDraft = { fullName: string; phone: string; intent: 'VISIT' | 'JOINING' };

/** How many people a member brought (or "nobody"), and who they were. */
function BroughtDialog({
  member,
  sheet,
  onClose,
  onSaved,
}: {
  member: { id: string; fullName: string } | null;
  sheet: AttendanceSheetDto;
  onClose: () => void;
  onSaved: (s: AttendanceSheetDto) => void;
}) {
  const [count, setCount] = useState(0);
  const [guests, setGuests] = useState<GuestDraft[]>([]);
  const converted = member ? sheet.guests.filter((g) => g.broughtBy?.id === member.id && g.convertedMember) : [];
  useEffect(() => {
    if (!member) return;
    const mine = sheet.guests.filter((g) => g.broughtBy?.id === member.id && !g.convertedMember);
    setGuests(mine.map((g) => ({ fullName: g.fullName ?? '', phone: g.phone ?? '', intent: g.intent })));
    setCount(sheet.brought[member.id] ?? mine.length + converted.length);
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep one row per person brought (names are optional).
  const setN = (n: number) => {
    const v = Math.max(0, Math.min(200, n));
    setCount(v);
    const rows = Math.max(0, v - converted.length);
    setGuests((g) => (g.length > rows ? g.slice(0, rows) : [...g, ...Array.from({ length: rows - g.length }, () => ({ fullName: '', phone: '', intent: 'VISIT' as const }))]));
  };
  const save = useMutation({
    mutationFn: () =>
      api<AttendanceSheetDto>(`/attendance/sessions/${sheet.session.id}/brought/${member!.id}`, {
        method: 'PUT',
        body: { broughtCount: count, guests: guests.map((g) => ({ fullName: g.fullName.trim() || null, phone: g.phone.trim() || null, intent: g.intent })) },
      }),
    onSuccess: (s) => {
      toast.success(count ? `${member!.fullName} brought ${count}` : `${member!.fullName} brought nobody`);
      onSaved(s);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (i: number, patch: Partial<GuestDraft>) => setGuests((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={member ? `Who did ${member.fullName} bring?` : ''}
      description="Count everyone they brought. Names and phone numbers are optional but help with follow-up."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={count === 0 ? 'primary' : 'outline'} size="sm" onClick={() => setN(0)}>
            Brought nobody
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="outline" aria-label="One fewer" disabled={count <= converted.length} onClick={() => setN(count - 1)}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xl font-semibold tabular-nums" aria-live="polite">
              {count}
            </span>
            <Button size="icon" variant="outline" aria-label="One more" onClick={() => setN(count + 1)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {converted.length > 0 && (
          <p className="text-xs text-muted">
            Includes {converted.map((g) => g.convertedMember!.fullName).join(', ')}, who {converted.length === 1 ? 'is' : 'are'} now a member.
          </p>
        )}
        {guests.map((g, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              <Input placeholder={`Person ${i + 1 + converted.length}: name (optional)`} maxLength={120} value={g.fullName} onChange={(e) => set(i, { fullName: e.target.value })} />
              <Input placeholder="Phone (optional)" type="tel" inputMode="tel" maxLength={30} value={g.phone} onChange={(e) => set(i, { phone: e.target.value })} />
            </div>
            <div className="inline-flex rounded-lg border border-border p-0.5 text-sm" role="radiogroup" aria-label="Visiting or joining">
              {(['VISIT', 'JOINING'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={g.intent === k}
                  onClick={() => set(i, { intent: k })}
                  className={cn('rounded-md px-3 py-1', g.intent === k ? 'bg-brand text-white' : 'text-muted hover:text-fg')}
                >
                  {GUEST_INTENT_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Church services: the ushers enter a head-count (total, of which visitors and new converts). */
function ServiceCounts({ sheet: s, onSaved }: { sheet: AttendanceSheetDto; onSaved: (r: AttendanceSheetDto) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const info = s.session;
  const [f, setF] = useState({
    total: String(info.headcount ?? 0),
    visitors: String(info.visitorCount),
    converts: String(info.newConvertCount),
    title: info.title ?? '',
    serviceType: info.serviceType,
    date: info.date,
    notes: info.notes ?? '',
  });
  const n = (v: string) => Number(v || 0);
  const members = n(f.total) - n(f.visitors) - n(f.converts);
  const sunday = isPerServiceType(f.serviceType);
  const invalid = members < 0;
  const save = useMutation({
    mutationFn: () =>
      api<AttendanceSheetDto>(`/attendance/sessions/${info.id}`, {
        method: 'PUT',
        body: {
          rosterIds: [],
          presentIds: [],
          headcount: n(f.total),
          visitorCount: n(f.visitors),
          newConvertCount: n(f.converts),
          serviceType: f.serviceType.trim() || undefined,
          title: f.title.trim() || null,
          date: f.date || undefined,
          notes: f.notes || null,
        },
      }),
    onSuccess: (r) => {
      onSaved(r);
      toast.success(`Saved: ${n(f.total)} at ${r.session.serviceType}${r.session.title ? ` (${r.session.title})` : ''}`);
      router.push('/church/attendance');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const num = (k: 'total' | 'visitors' | 'converts') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') });
  return (
    <div className="pb-10">
      <PageHeader title={sessionName(info)} subtitle={`${formatDay(info.date)} · church service head-count`}>
        <Link href="/church/attendance" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Attendance
        </Link>
      </PageHeader>
      {s.canEdit && (
        <div className="mb-4">
          <SelfCheckinCard sessionId={info.id} label={`${sessionName(info)} · ${formatDay(info.date)}`} />
        </div>
      )}
      {!s.canEdit ? (
        <Card className="max-w-xl space-y-2 p-5 text-sm">
          <p className="flex items-center gap-2 text-muted">
            <Lock className="h-4 w-4" /> Recorded by the ushers. You can view it.
          </p>
          <p className="text-3xl font-semibold tabular-nums">{info.headcount ?? 0}</p>
          <p className="text-muted">
            {Math.max(0, (info.headcount ?? 0) - info.visitorCount - info.newConvertCount)} members · {info.visitorCount} visitors · {info.newConvertCount} new converts
          </p>
        </Card>
      ) : (
        <Card className="max-w-xl p-5">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid) save.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label="Service" htmlFor="sc-type">
                <Input id="sc-type" list="sc-types" maxLength={40} value={f.serviceType} onChange={(e) => setF({ ...f, serviceType: e.target.value })} />
                <datalist id="sc-types">
                  {SERVICE_TYPE_SUGGESTIONS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              {sunday ? (
                <Field label="Which service" htmlFor="sc-title">
                  <Select id="sc-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}>
                    {SUNDAY_SERVICE_TITLES.map((t) => (
                      <option key={t} value={t}>
                        {t[0]!.toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Title (optional)" htmlFor="sc-title">
                  <Input id="sc-title" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
                </Field>
              )}
            </div>
            <Field label="Date" htmlFor="sc-date">
              <Input id="sc-date" type="date" max={localDate()} value={f.date} onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Field label="Total present" htmlFor="sc-total" hint="Everyone counted">
                <Input id="sc-total" type="number" inputMode="numeric" min={0} value={f.total} onChange={num('total')} autoFocus />
              </Field>
              <Field label="Visitors" htmlFor="sc-vis" hint="Of the total">
                <Input id="sc-vis" type="number" inputMode="numeric" min={0} value={f.visitors} onChange={num('visitors')} />
              </Field>
              <Field label="New converts" htmlFor="sc-nc" hint="Of the total">
                <Input id="sc-nc" type="number" inputMode="numeric" min={0} value={f.converts} onChange={num('converts')} />
              </Field>
            </div>
            <p className={cn('rounded-lg p-3 text-sm', invalid ? 'bg-danger/10 text-danger' : 'bg-surface-2')}>
              {invalid ? 'Visitors and new converts can’t add up to more than the total.' : <>Members: <b className="tabular-nums">{members}</b> · visitors {n(f.visitors)} · new converts {n(f.converts)}</>}
            </p>
            <Field label="Notes (optional)" htmlFor="sc-notes">
              <Textarea id="sc-notes" maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-16" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={save.isPending} disabled={invalid}>
                Save head-count
              </Button>
              <ConfirmButton
                variant="ghost"
                danger
                className="ml-auto text-danger"
                title="Delete this service record?"
                description={`Removes the head-count for ${sessionName(info)} on ${formatDay(info.date)}. This cannot be undone.`}
                confirmLabel="Delete"
                onConfirm={async () => {
                  try {
                    await api(`/attendance/sessions/${info.id}`, { method: 'DELETE' });
                    toast.success('Service record deleted');
                    void qc.invalidateQueries({ queryKey: ['attendance'] });
                    router.replace('/church/attendance');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </ConfirmButton>
            </div>
            {info.recordedBy && (
              <p className="text-xs text-muted">
                Last saved by {info.recordedBy} on {new Date(info.updatedAt).toLocaleString()}
              </p>
            )}
          </form>
        </Card>
      )}
    </div>
  );
}

export default function SessionSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const key = mk.session(id);
  const sheet = useQuery({ queryKey: key, queryFn: () => api<AttendanceSheetDto>(`/attendance/sessions/${id}`) });
  const s = sheet.data;

  // Unsaved tick changes on top of what's saved: refreshing the roster never loses them.
  const [changes, setChanges] = useState<Map<string, boolean>>(new Map());
  const [meta, setMeta] = useState({ visitors: '0', firstTimers: '0', notes: '', serviceType: '', title: '', date: '' });
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
    mutationFn: (body: ReturnType<typeof sheetBody>) => api<AttendanceSheetDto>(`/attendance/sessions/${id}`, { method: 'PUT', body }),
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
      queueSave({ userId: me.data.id, path: `/attendance/sessions/${id}`, method: 'PUT', body, label: `${s.session.group?.name ?? s.session.serviceType} ${s.session.date}` });
      setChanges(new Map());
      // Stay here: other pages may not load without signal.
      toast.success('No signal: saved on this phone. It will be sent automatically when you’re back online.', { duration: 8000 });
    },
  });

  if (sheet.isLoading) return <PageLoader />;
  if (!s) return <EmptyState title="Couldn’t open this attendance sheet">{sheet.error ? errorMessage(sheet.error) : null}</EmptyState>;
  if (s.session.kind === 'CHURCH_SERVICE') return <ServiceCounts sheet={s} onSaved={refreshAll} />;
  const term = q.trim().toLowerCase();
  const constituencies = [...new Map(s.roster.filter((m) => m.constituencyId).map((m) => [m.constituencyId!, m.constituency!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const teams = [...new Map(s.roster.flatMap((m) => m.teamRoles).map((r) => [r.id, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = s.roster.filter(
    (m) =>
      (!con || (con === 'none' ? !m.constituencyId : m.constituencyId === con)) &&
      (!teamFilter || m.teamRoles.some((r) => r.id === teamFilter)) &&
      (!term || m.fullName.toLowerCase().includes(term) || m.churchRole.toLowerCase().includes(term) || m.teamRoles.some((r) => r.name.toLowerCase().includes(term))),
  );
  const presentCount = s.roster.filter((m) => isPresent(m.id)).length;
  const toggle = (mid: string) => s.canEdit && setChanges((c) => new Map(c).set(mid, !isPresent(mid)));
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
            <Input id="sh-type" list="sh-types" maxLength={40} value={meta.serviceType} onChange={(e) => setMeta({ ...meta, serviceType: e.target.value })} />
            <datalist id="sh-types">
              {suggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </Field>
          <Field label="Title" htmlFor="sh-title">
            <Input id="sh-title" maxLength={120} placeholder="Optional" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </Field>
          <Field label="Date" htmlFor="sh-date">
            <Input id="sh-date" type="date" max={localDate()} value={meta.date} onChange={(e) => e.target.value && setMeta({ ...meta, date: e.target.value })} />
          </Field>
          <Field label="Visitors" htmlFor="sh-vis" hint="Not on the member list">
            <Input id="sh-vis" type="number" inputMode="numeric" min={0} value={meta.visitors} onChange={(e) => setMeta({ ...meta, visitors: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="First-timers" htmlFor="sh-ft" hint="Of the visitors">
            <Input id="sh-ft" type="number" inputMode="numeric" min={0} value={meta.firstTimers} onChange={(e) => setMeta({ ...meta, firstTimers: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </Card>
      ) : (
        <>
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">
            <Lock className="h-4 w-4 shrink-0" /> You can view this sheet. Only {s.session.group ? 'this group’s leaders' : 'pastors'} or a Super Admin can change it.
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
              <Input className="pl-9" placeholder="Find a member…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                    className={cn('flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors', s.canEdit && 'hover:bg-surface-2')}
                  >
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2', on ? 'border-brand bg-brand text-white' : 'border-border')}>
                      {on && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.fullName}</span>
                      <span className="block truncate text-xs text-muted">
                        {m.teamRoles.length ? m.teamRoles.map((r) => r.name).join(', ') : m.churchRole}
                        {!s.session.group || s.session.group.type === 'BACENTA' ? ` · ${m.constituency ?? 'No constituency'}` : ''}
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
                        b === undefined ? 'border-dashed border-border text-muted hover:text-fg' : b > 0 ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border text-muted',
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
            {s.roster.length ? 'No members match.' : s.session.group ? 'This group has no members yet. Add members from the group page.' : 'No members yet. Add members first.'}
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
                  <Badge tone={g.intent === 'JOINING' ? 'brand' : 'neutral'}>{GUEST_INTENT_LABELS[g.intent]}</Badge>
                )}
                {s.canEdit && !g.convertedMember && (
                  <Button size="sm" variant={g.intent === 'JOINING' ? 'primary' : 'outline'} onClick={() => setConvert(g)}>
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
            <Textarea id="sh-notes" maxLength={1000} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} className="min-h-16" placeholder="e.g. Rain kept numbers down" />
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
