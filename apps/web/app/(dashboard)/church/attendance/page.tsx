'use client';

import { FollowUpButton } from '@/components/church/follow-up';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Download, Phone, UserPlus, UserX } from 'lucide-react';
import { GROUP_TYPE_LABELS, type GuestDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { Pager } from '@/components/ui/pager';
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/table';
import { ChurchTabs, MemberFormDialog } from '@/components/church/church-ui';
import { ColumnTrend, Doughnut, RankedBars } from '@/components/church/charts';
import { GroupStatsPanel, Stat } from '@/components/church/group-stats';
import { DayBreakdown } from '@/components/church/day-breakdown';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { addDays, canAddMembers, downloadCsv, formatDay, localDate, mk, sessionName, useClientPage, useCursorList, useGroups, type SessionRow, type Summary } from '@/lib/membership';

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
  const avg = services.length ? Math.round(services.reduce((a, x) => a + x.total, 0) / services.length) : 0;
  const visitors = services.reduce((a, x) => a + x.visitors, 0);
  const converts = services.reduce((a, x) => a + x.newConverts, 0);
  const members = services.reduce((a, x) => a + x.members, 0);
  const brought = s ? s.guests.visit + s.guests.joining : 0;
  // Tables show 10 at a time with Previous/Next, like the other lists.
  const servicePage = useClientPage(useMemo(() => [...services].reverse(), [services]));
  const groupPage = useClientPage(s?.groups ?? []);

  const exportCsv = () => {
    if (!s) return;
    downloadCsv(`attendance ${s.from} to ${s.to}.csv`, [
      ['Date', 'Service', 'Title', 'Total', 'Members', 'Visitors', 'New converts'],
      ...s.services.map((x) => [x.date, x.serviceType, x.title, x.total, x.members, x.visitors, x.newConverts]),
      [],
      ['Constituency', 'Average per meeting day (sum of basontas)', 'Days recorded'],
      ...s.constituencyAverages.map((c) => [c.name, c.average, c.days]),
      [],
      ['Group', 'Type', 'Pastor', 'Members', 'Meetings', 'Average present', 'Last meeting'],
      ...s.groups.map((g) => [g.name, GROUP_TYPE_LABELS[g.type], g.pastor, g.members, g.meetings, g.averagePresent, g.lastMeeting]),
      [],
      ['Not seen in this period', 'Phone', 'Constituency', 'Last seen'],
      ...s.absentees.map((a) => [a.fullName, a.phone, a.constituency, a.lastSeen]),
    ]);
  };

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
            <Stat label="Latest service" value={latest ? latest.total : '—'} sub={latest ? `${sessionName(latest)} · ${formatDay(latest.date)}` : 'None in this period'} />
            <Stat label="Average service" value={services.length ? avg : '—'} sub={`${services.length} service${services.length === 1 ? '' : 's'} · ${s.activeMembers} active members`} />
            <Stat label="Visitors" value={visitors} sub={`${converts} new converts`} />
            <Stat label="Brought by members" value={brought} sub={`${s.guests.converted} became members`} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="p-4 xl:col-span-2">
              <h2 className="mb-1 font-semibold">Church services</h2>
              <p className="mb-3 text-xs text-muted">Head-counts recorded by the ushers.</p>
              <ColumnTrend data={services.map((x) => ({ key: x.id, label: formatDay(x.date), detail: `${formatDay(x.date)} · ${sessionName(x)}`, value: x.total }))} unit="people" />
            </Card>
            <Card className="space-y-6 p-4">
              <Doughnut
                title="Who came (all services)"
                centerLabel="people"
                slices={[
                  { label: 'Members', value: members },
                  { label: 'Visitors', value: visitors },
                  { label: 'New converts', value: converts },
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
              <p className="mb-3 text-xs text-muted">Each constituency’s basontas added up, averaged over the days they met.</p>
              <RankedBars rows={s.constituencyAverages.map((c) => ({ key: c.id, label: c.name, value: Math.round(c.average) }))} empty="No constituencies yet." />
            </Card>
            <Card className="space-y-5 p-4">
              <div>
                <h2 className="mb-3 font-semibold">Average by kind of service</h2>
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Members per basonta</h2>
              <RankedBars rows={s.basontas.map((b) => ({ key: b.id, label: b.name, value: b.members }))} unit="members" empty="No basontas yet." />
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">Members per bacenta</h2>
              <RankedBars rows={s.bacentas.map((b) => ({ key: b.id, label: b.name, value: b.members }))} unit="members" empty="No bacentas yet." />
            </Card>
          </div>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Services</h2>
            {services.length ? (
              <>
              <Table>
                <THead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Service</Th>
                    <Th numeric>Total</Th>
                    <Th numeric>Members</Th>
                    <Th numeric>Visitors</Th>
                    <Th numeric>New converts</Th>
                  </tr>
                </THead>
                <TBody>
                  {servicePage.items.map((x) => (
                    <Tr key={x.id}>
                      <Td className="whitespace-nowrap">{formatDay(x.date)}</Td>
                      <Td>
                        <Link href={`/church/attendance/s/${x.id}`} className="font-medium hover:text-brand">
                          {sessionName(x)}
                        </Link>
                      </Td>
                      <Td numeric className="font-semibold">
                        {x.total}
                      </Td>
                      <Td numeric>{x.members}</Td>
                      <Td numeric>{x.visitors}</Td>
                      <Td numeric>{x.newConverts}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pager list={servicePage} />
              </>
            ) : (
              <p className="text-sm text-muted">No church services recorded in this period.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 font-semibold">Groups</h2>
            <p className="mb-3 text-xs text-muted">Constituencies show the total of their basontas per meeting day.</p>
            {s.groups.length ? (
              <>
              <Table>
                <THead>
                  <tr>
                    <Th>Group</Th>
                    <Th>Pastor</Th>
                    <Th numeric>Members</Th>
                    <Th numeric>Meetings</Th>
                    <Th numeric>Avg present</Th>
                    <Th>Last meeting</Th>
                  </tr>
                </THead>
                <TBody>
                  {groupPage.items.map((g) => (
                    <Tr key={g.id}>
                      <Td>
                        <Link href={`/church/groups/${g.id}`} className="font-medium hover:text-brand">
                          {g.name}
                        </Link>
                        <span className="ml-2 text-xs text-muted">{GROUP_TYPE_LABELS[g.type]}</span>
                      </Td>
                      <Td>{g.pastor ?? '—'}</Td>
                      <Td numeric>{g.members}</Td>
                      <Td numeric>{g.meetings}</Td>
                      <Td numeric>{g.meetings ? g.averagePresent : '—'}</Td>
                      <Td className="whitespace-nowrap">{g.lastMeeting ? formatDay(g.lastMeeting) : '—'}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pager list={groupPage} />
              </>
            ) : (
              <p className="text-sm text-muted">No groups yet.</p>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-2 font-semibold">
              <UserX className="h-4 w-4 text-muted" /> Follow up: not seen in this period ({s.absentees.length})
            </h2>
            <p className="mb-3 text-xs text-muted">Active members not marked present at any basonta or bacenta meeting between these dates.</p>
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
              <p className="text-sm text-muted">{services.length || s.groups.some((g) => g.meetings) ? 'Everyone was seen at least once.' : 'Record some attendance to see who needs a follow-up.'}</p>
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
  const list = useCursorList<GuestDto>(mk.pendingGuests, '/attendance/guests/pending');
  const [guest, setGuest] = useState<GuestDto | null>(null);
  if (!list.items.length) return null;
  return (
    <Card className="p-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <UserPlus className="h-4 w-4 text-muted" /> New people who want to join ({list.total ?? list.items.length})
      </h2>
      <p className="mb-3 text-xs text-muted">Brought by members (or from visitor cards) and marked “wants to join”. Add them as members of a constituency, a basonta, or both.</p>
      <ul className="divide-y divide-border">
        {list.items.map((g) => (
          <li key={g.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{g.fullName || 'Name not recorded'}</p>
              <p className="truncate text-xs text-muted">
                {g.fromCard ? 'Filled in a visitor card' : g.broughtBy ? `Brought by ${g.broughtBy.fullName}` : 'Brought by a former member'}
                {g.session ? ` · ${sessionName(g.session)} · ${formatDay(g.session.date)}` : ''}
              </p>
            </div>
            {g.phone && (
              <a href={`tel:${g.phone}`} className="rounded-lg p-2 text-brand hover:bg-surface-2" aria-label={`Call ${g.fullName ?? 'guest'}`}>
                <Phone className="h-4 w-4" />
              </a>
            )}
            <FollowUpButton guestId={g.id} name={g.fullName ?? 'this person'} defaultReason="Wants to join: welcome call" />
            <Button size="sm" onClick={() => setGuest(g)}>
              Make member
            </Button>
          </li>
        ))}
      </ul>
      <Pager list={list} />
      <MemberFormDialog
        open={!!guest}
        onOpenChange={(o) => !o && setGuest(null)}
        defaults={guest ? { fullName: guest.fullName ?? '', phone: guest.phone ?? '', fromGuestId: guest.id, title: 'Make a member' } : undefined}
        onSaved={() => void list.refetch()}
      />
    </Card>
  );
}

function RecentSessions() {
  const list = useCursorList<SessionRow>(mk.sessions({ mine: true }), '/attendance/sessions', { mine: true });
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold">Recent attendance</h2>
      {list.isLoading ? (
        <PageLoader />
      ) : list.items.length ? (
        <>
          <ul className="divide-y divide-border text-sm">
            {list.items.map((s) => (
              <li key={s.id}>
                <Link href={`/church/attendance/s/${s.id}`} className="flex min-w-0 items-center gap-3 py-2 hover:text-brand">
                  <span className="w-28 shrink-0 text-muted">{formatDay(s.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{sessionName(s)}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {s.present} {s.kind === 'CHURCH_SERVICE' ? 'people' : 'present'}
                    {s.guests ? ` · ${s.guests} brought` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Pager list={list} />
        </>
      ) : (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
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
  // Basonta/bacenta leaders record their meetings; the ushers record church services.
  const canRecord = p.canRecordSunday || (groups.data ?? []).some((g) => g.canManage && g.type !== 'CONSTITUENCY');
  return (
    <>
      <PageHeader
        title="Church"
        subtitle="Church services (head-counts), and basonta and bacenta meetings."
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
        <DayBreakdown />
        {p.canViewChurchStats ? <ChurchStats /> : <MyGroupStats />}
        <RecentSessions />
      </div>
    </>
  );
}
