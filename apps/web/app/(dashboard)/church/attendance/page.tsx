'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Download, Phone, UserPlus, UserX } from 'lucide-react';
import type { GuestDto, MeResponse } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, MemberFormDialog } from '@/components/church/church-ui';
import { ColumnTrend, Doughnut, RankedBars } from '@/components/church/charts';
import { GroupStatsPanel, Stat } from '@/components/church/group-stats';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { addDays, canAddMembers, downloadCsv, formatDay, localDate, mk, sessionName, useGroups, type SessionRow, type Summary } from '@/lib/membership';

const RANGES = [
  { label: 'Last 4 weeks', days: 27 },
  { label: 'Last 8 weeks', days: 55 },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 12 months', days: 364 },
];

function ChurchStats() {
  const [days, setDays] = useState(55);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const to = custom?.to ?? localDate();
  const from = custom?.from ?? addDays(to, -days);
  const summary = useQuery({ queryKey: mk.summary({ from, to }), queryFn: () => api<Summary>('/attendance/summary', { query: { from, to } }), placeholderData: keepPreviousData });
  const s = summary.data;
  const services = s?.services ?? [];
  const latest = services[services.length - 1];
  const avg = services.length ? Math.round(services.reduce((a, x) => a + x.present, 0) / services.length) : 0;
  const visitors = services.reduce((a, x) => a + x.visitors, 0);
  const firstTimers = services.reduce((a, x) => a + x.firstTimers, 0);
  const members = services.reduce((a, x) => a + x.present, 0);
  const brought = s ? s.guests.visit + s.guests.joining : 0;

  const exportCsv = () => {
    if (!s) return;
    const cons = s.constituencies;
    downloadCsv(`attendance ${s.from} to ${s.to}.csv`, [
      ['Date', 'Service', 'Title', 'Members present', 'Visitors', 'First-timers', 'Brought by members', ...cons.map((c) => c.name), 'No constituency'],
      ...s.services.map((x) => [x.date, x.serviceType, x.title, x.present, x.visitors, x.firstTimers, x.guests, ...cons.map((c) => x.byConstituency[c.id] ?? 0), x.byConstituency.none ?? 0]),
      [],
      ['Group', 'Type', 'Pastor', 'Members', 'Meetings', 'Average present', 'Last meeting'],
      ...s.groups.map((g) => [g.name, g.type === 'CONSTITUENCY' ? 'Constituency' : 'Basonta', g.pastor, g.members, g.meetings, g.averagePresent, g.lastMeeting]),
      [],
      ['Not seen in this period', 'Phone', 'Constituency', 'Last seen'],
      ...s.absentees.map((a) => [a.fullName, a.phone, a.constituency, a.lastSeen]),
    ]);
  };

  // Average attendance per constituency across the period's services.
  const perConstituency = s
    ? s.constituencies.map((c) => ({
        key: c.id,
        label: c.name,
        value: services.length ? Math.round(services.reduce((a, x) => a + (x.byConstituency[c.id] ?? 0), 0) / services.length) : 0,
      }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          className="w-full sm:w-48"
          value={custom ? 'custom' : String(days)}
          onChange={(e) => (e.target.value === 'custom' ? setCustom({ from, to }) : (setCustom(null), setDays(Number(e.target.value))))}
          aria-label="Period"
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
          <option value="custom">Custom dates…</option>
        </Select>
        {custom && (
          <div className="flex w-full min-w-0 gap-2 sm:w-auto">
            <Input type="date" className="flex-1" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
            <Input type="date" className="flex-1" aria-label="To" value={custom.to} min={custom.from} max={localDate()} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <span className="mr-auto text-sm text-muted">
          {formatDay(from)} – {formatDay(to)}
        </span>
        <Button variant="outline" onClick={exportCsv} disabled={!s}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </div>

      {!s ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Latest service" value={latest ? latest.present : '—'} sub={latest ? `${latest.serviceType} · ${formatDay(latest.date)}` : 'None in this period'} />
            <Stat label="Average attendance" value={services.length ? avg : '—'} sub={`${services.length} service${services.length === 1 ? '' : 's'} · ${s.activeMembers} active members`} />
            <Stat label="Visitors" value={visitors} sub={`${firstTimers} first-timers`} />
            <Stat label="Brought by members" value={brought} sub={`${s.guests.converted} became members`} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="p-4 xl:col-span-2">
              <h2 className="mb-3 font-semibold">Attendance at church services</h2>
              <ColumnTrend data={services.map((x) => ({ key: x.id, label: formatDay(x.date), detail: `${formatDay(x.date)} · ${sessionName(x)}`, value: x.present }))} unit="members" />
            </Card>
            <Card className="space-y-6 p-4">
              <Doughnut
                title="Who came (all services)"
                centerLabel="people"
                slices={[
                  { label: 'Members', value: members },
                  { label: 'Returning visitors', value: Math.max(0, visitors - firstTimers) },
                  { label: 'First-timers', value: firstTimers },
                ]}
              />
              <Doughnut
                title="People members brought"
                centerLabel="brought"
                slices={[
                  { label: 'Just visiting', value: s.guests.visit },
                  { label: 'Want to join', value: s.guests.joining },
                ]}
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-4">
              <h2 className="mb-1 font-semibold">Average attendance by constituency</h2>
              <p className="mb-3 text-xs text-muted">Members present per service, averaged over the period.</p>
              <RankedBars rows={perConstituency} empty="No constituencies yet." />
            </Card>
            <Card className="space-y-5 p-4">
              <div>
                <h2 className="mb-3 font-semibold">Average attendance by kind of service</h2>
                <RankedBars rows={s.serviceTypes.map((t) => ({ key: t.serviceType, label: `${t.serviceType} (${t.sessions})`, value: Math.round(t.averagePresent) }))} empty="No services in this period." />
              </div>
              <Doughnut
                title="Did members bring someone?"
                centerLabel="answers"
                slices={[
                  { label: 'Brought someone', value: s.guests.broughtSome },
                  { label: 'Brought nobody', value: s.guests.broughtNone },
                ]}
              />
            </Card>
          </div>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Members per basonta</h2>
            <RankedBars rows={s.basontas.map((b) => ({ key: b.id, label: b.name, value: b.members }))} unit="members" empty="No basontas yet." />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Services</h2>
            {services.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-4 font-medium">Date</th>
                      <th className="py-2 pr-4 font-medium">Service</th>
                      <th className="py-2 pr-4 text-right font-medium">Members</th>
                      <th className="py-2 pr-4 text-right font-medium">Visitors</th>
                      <th className="py-2 pr-4 text-right font-medium">First-timers</th>
                      <th className="py-2 pr-4 text-right font-medium">Brought</th>
                      {s.constituencies.map((c) => (
                        <th key={c.id} className="py-2 pr-4 text-right font-medium">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {[...services].reverse().map((x) => (
                      <tr key={x.id} className="hover:bg-surface-2">
                        <td className="py-2 pr-4">{formatDay(x.date)}</td>
                        <td className="py-2 pr-4">
                          <Link href={`/church/attendance/s/${x.id}`} className="hover:text-brand">
                            {sessionName(x)}
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-right font-medium">{x.present}</td>
                        <td className="py-2 pr-4 text-right">{x.visitors}</td>
                        <td className="py-2 pr-4 text-right">{x.firstTimers}</td>
                        <td className="py-2 pr-4 text-right">{x.guests}</td>
                        {s.constituencies.map((c) => (
                          <td key={c.id} className="py-2 pr-4 text-right">
                            {x.byConstituency[c.id] ?? 0}
                            <span className="text-muted">/{c.members}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">No church services recorded in this period.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Group meetings</h2>
            {s.groups.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-4 font-medium">Group</th>
                      <th className="py-2 pr-4 font-medium">Pastor</th>
                      <th className="py-2 pr-4 text-right font-medium">Members</th>
                      <th className="py-2 pr-4 text-right font-medium">Meetings</th>
                      <th className="py-2 pr-4 text-right font-medium">Avg present</th>
                      <th className="py-2 pr-4 font-medium">Last meeting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {s.groups.map((g) => (
                      <tr key={g.id} className="hover:bg-surface-2">
                        <td className="py-2 pr-4">
                          <Link href={`/church/groups/${g.id}`} className="font-medium hover:text-brand">
                            {g.name}
                          </Link>
                          <span className="ml-2 text-xs text-muted">{g.type === 'CONSTITUENCY' ? 'Constituency' : 'Basonta'}</span>
                        </td>
                        <td className="py-2 pr-4">{g.pastor ?? '—'}</td>
                        <td className="py-2 pr-4 text-right">{g.members}</td>
                        <td className="py-2 pr-4 text-right">{g.meetings}</td>
                        <td className="py-2 pr-4 text-right">{g.meetings ? g.averagePresent : '—'}</td>
                        <td className="py-2 pr-4">{g.lastMeeting ? formatDay(g.lastMeeting) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">No groups yet.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-2 font-semibold">
              <UserX className="h-4 w-4 text-muted" /> Follow up: not seen in this period ({s.absentees.length})
            </h2>
            <p className="mb-3 text-xs text-muted">Active members not marked present at any service or meeting between these dates.</p>
            {s.absentees.length ? (
              <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
                {s.absentees.map((a) => (
                  <li key={a.id} className="flex min-w-0 items-center gap-2 border-b border-border py-2">
                    <Link href={`/church/members/${a.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium hover:text-brand">{a.fullName}</p>
                      <p className="truncate text-xs text-muted">
                        {a.constituency ?? 'No constituency'} · last seen {a.lastSeen ? formatDay(a.lastSeen) : 'never'}
                      </p>
                    </Link>
                    {a.phone && (
                      <a href={`tel:${a.phone}`} className="shrink-0 rounded-lg p-2 text-brand hover:bg-surface-2" aria-label={`Call ${a.fullName}`}>
                        <Phone className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{services.length ? 'Everyone was seen at least once.' : 'Record some attendance to see who needs a follow-up.'}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/** Pastors and shepherds: charts for the groups they lead. */
function MyGroupStats() {
  const groups = useGroups();
  const mine = (groups.data ?? []).filter((g) => g.canManage);
  const [id, setId] = useState('');
  if (groups.isLoading) return <PageLoader />;
  if (!mine.length)
    return <Card className="p-4 text-sm text-muted">Statistics appear here for the groups you lead or shepherd. You aren’t leading a group yet: a Super Admin can assign you to one.</Card>;
  const current = mine.find((g) => g.id === id) ?? mine[0]!;
  return (
    <div className="space-y-3">
      {mine.length > 1 && (
        <Select className="w-full sm:w-72" value={current.id} onChange={(e) => setId(e.target.value)} aria-label="Group">
          {mine.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      )}
      <GroupStatsPanel key={current.id} groupId={current.id} groupName={current.name} />
    </div>
  );
}

function PendingGuests() {
  const q = useQuery({ queryKey: mk.pendingGuests, queryFn: () => api<GuestDto[]>('/attendance/guests/pending') });
  const [guest, setGuest] = useState<GuestDto | null>(null);
  if (!q.data?.length) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <UserPlus className="h-4 w-4 text-muted" /> New people who want to join ({q.data.length})
      </h2>
      <p className="mb-3 text-xs text-muted">Brought by members and marked “wants to join”. Add them as members of a constituency, a basonta, or both.</p>
      <ul className="divide-y divide-border">
        {q.data.map((g) => (
          <li key={g.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{g.fullName || 'Name not recorded'}</p>
              <p className="truncate text-xs text-muted">
                {g.broughtBy ? `Brought by ${g.broughtBy.fullName}` : 'Brought by a former member'}
                {g.session ? ` · ${sessionName(g.session)} · ${formatDay(g.session.date)}` : ''}
              </p>
            </div>
            {g.phone && (
              <a href={`tel:${g.phone}`} className="rounded-lg p-2 text-brand hover:bg-surface-2" aria-label={`Call ${g.fullName ?? 'guest'}`}>
                <Phone className="h-4 w-4" />
              </a>
            )}
            <Button size="sm" onClick={() => setGuest(g)}>
              Make member
            </Button>
          </li>
        ))}
      </ul>
      <MemberFormDialog
        open={!!guest}
        onOpenChange={(o) => !o && setGuest(null)}
        defaults={guest ? { fullName: guest.fullName ?? '', phone: guest.phone ?? '', fromGuestId: guest.id, title: 'Make a member' } : undefined}
        onSaved={() => void q.refetch()}
      />
    </Card>
  );
}

function RecentSessions({ me }: { me: MeResponse }) {
  const groups = useGroups();
  const from = addDays(localDate(), -60);
  const q = useQuery({ queryKey: mk.sessions({ from }), queryFn: () => api<SessionRow[]>('/attendance/sessions', { query: { from } }) });
  const mine = new Set((groups.data ?? []).filter((g) => g.canManage).map((g) => g.id));
  const rows = (q.data ?? []).filter((s) => me.permissions.canViewChurchStats || !s.group || mine.has(s.group.id)).slice(0, 12);
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold">Recent attendance</h2>
      {rows.length ? (
        <ul className="divide-y divide-border text-sm">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/church/attendance/s/${s.id}`} className="flex min-w-0 items-center gap-3 py-2 hover:text-brand">
                <span className="w-28 shrink-0 text-muted">{formatDay(s.date)}</span>
                <span className="min-w-0 flex-1 truncate">{sessionName(s)}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {s.present} present{s.guests ? ` · ${s.guests} brought` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing recorded in the last 60 days.</p>
      )}
    </Card>
  );
}

export default function AttendancePage() {
  const me = useMe();
  const groups = useGroups();
  const p = me.data?.permissions;
  if (me.isLoading) return <PageLoader />;
  if (!me.data || !p?.canViewMembership) return <EmptyState title="You don’t have access to attendance" />;
  const canRecord = p.canRecordSunday || (groups.data ?? []).some((g) => g.canManage);
  return (
    <>
      <PageHeader
        title="Church"
        subtitle="Who came to services, camps, all-nights and group meetings."
        actions={
          canRecord && (
            <Link href="/church/attendance/new">
              <Button>
                <ClipboardCheck className="h-4 w-4" /> Record attendance
              </Button>
            </Link>
          )
        }
      />
      <ChurchTabs />
      <div className="space-y-4">
        {canAddMembers(me.data) && <PendingGuests />}
        {p.canViewChurchStats ? <ChurchStats /> : <MyGroupStats />}
        <RecentSessions me={me.data} />
      </div>
    </>
  );
}
