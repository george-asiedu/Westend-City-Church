'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Download, Phone, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs } from '@/components/church/church-ui';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { addDays, downloadCsv, formatDay, lastSunday, localDate, mk, useGroups, type Summary } from '@/lib/membership';
import { cn } from '@/lib/utils';

const RANGES = [
  { label: 'Last 4 weeks', days: 27 },
  { label: 'Last 8 weeks', days: 55 },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 12 months', days: 364 },
];

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </Card>
  );
}

/** Single-series column chart of Sunday attendance; the table below carries the exact numbers. */
function SundayTrend({ data }: { data: Summary['sundays'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((s) => s.present + s.visitors));
  const h = hover !== null ? data[hover] : null;
  return (
    <div>
      <div className="mb-2 h-5 text-sm text-muted" aria-live="polite">
        {h ? (
          <>
            <span className="font-medium text-fg">{formatDay(h.date)}</span>: {h.present} members{h.visitors ? `, ${h.visitors} visitors` : ''}
          </>
        ) : (
          'Hover or tap a bar for details'
        )}
      </div>
      <div className="flex h-40 items-end justify-around gap-[2px] border-b border-border" role="img" aria-label="Sunday attendance by date">
        {data.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="group flex h-full min-w-0 max-w-14 flex-1 items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => setHover(i)}
            aria-label={`${formatDay(s.date)}: ${s.present} members, ${s.visitors} visitors`}
          >
            <span
              className={cn('w-full max-w-10 rounded-t-[4px] bg-brand transition-opacity', hover !== null && hover !== i && 'opacity-40')}
              style={{ height: `${Math.max(2, (s.present / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{formatDay(data[0]!.date)}</span>
        {data.length > 1 && <span>{formatDay(data[data.length - 1]!.date)}</span>}
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const me = useMe();
  const groups = useGroups();
  const [days, setDays] = useState(55);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [groupId, setGroupId] = useState('');
  const to = custom?.to ?? localDate();
  const from = custom?.from ?? addDays(to, -days);
  const summary = useQuery({
    queryKey: mk.summary({ from, to }),
    queryFn: () => api<Summary>('/attendance/summary', { query: { from, to } }),
    placeholderData: keepPreviousData,
  });
  const p = me.data?.permissions;
  if (me.isLoading) return <PageLoader />;
  if (!p?.canViewMembership) return <EmptyState title="You don’t have access to attendance" />;
  const s = summary.data;
  const sundays = s?.sundays ?? [];
  const latest = sundays[sundays.length - 1];
  const avg = sundays.length ? Math.round(sundays.reduce((a, x) => a + x.present, 0) / sundays.length) : 0;
  const visitors = sundays.reduce((a, x) => a + x.visitors, 0);
  const firstTimers = sundays.reduce((a, x) => a + x.firstTimers, 0);
  const myGroups = (groups.data ?? []).filter((g) => g.canManage);

  const exportCsv = () => {
    if (!s) return;
    const cons = s.constituencies;
    downloadCsv(`attendance ${s.from} to ${s.to}.csv`, [
      ['Sunday', 'Members present', 'Visitors', 'First-timers', ...cons.map((c) => c.name), 'No constituency'],
      ...s.sundays.map((x) => [x.date, x.present, x.visitors, x.firstTimers, ...cons.map((c) => x.byConstituency[c.id] ?? 0), x.byConstituency.none ?? 0]),
      [],
      ['Group', 'Type', 'Pastor', 'Members', 'Meetings', 'Average present', 'Last meeting'],
      ...s.groups.map((g) => [g.name, g.type === 'CONSTITUENCY' ? 'Constituency' : 'Basonta', g.pastor, g.members, g.meetings, g.averagePresent, g.lastMeeting]),
      [],
      ['Not seen in this period', 'Phone', 'Constituency', 'Last seen'],
      ...s.absentees.map((a) => [a.fullName, a.phone, a.constituency, a.lastSeen]),
    ]);
  };

  return (
    <>
      <PageHeader
        title="Church"
        subtitle="Who came to church and to group meetings."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!s}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {p.canRecordSunday && (
              <Link href={`/church/attendance/take?kind=SUNDAY_SERVICE&date=${lastSunday()}`}>
                <Button>
                  <ClipboardCheck className="h-4 w-4" /> Sunday attendance
                </Button>
              </Link>
            )}
          </>
        }
      />
      <ChurchTabs />

      {myGroups.length > 0 && (
        <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Take attendance for a group meeting" htmlFor="take-group">
              <Select id="take-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Choose one of your groups…</option>
                {myGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.type === 'CONSTITUENCY' ? 'constituency' : 'basonta'})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Link href={groupId ? `/church/attendance/take?kind=GROUP_MEETING&groupId=${groupId}&date=${localDate()}` : '#'} aria-disabled={!groupId} className={cn(!groupId && 'pointer-events-none')}>
            <Button disabled={!groupId}>
              <ClipboardCheck className="h-4 w-4" /> Open sheet
            </Button>
          </Link>
        </Card>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2">
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
        <span className="text-sm text-muted">
          {formatDay(from)} – {formatDay(to)}
        </span>
      </div>

      {!s ? (
        <PageLoader />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Latest Sunday" value={latest ? latest.present : '—'} sub={latest ? formatDay(latest.date) : 'None recorded in this period'} />
            <Tile label="Average Sunday" value={sundays.length ? avg : '—'} sub={`${sundays.length} Sunday${sundays.length === 1 ? '' : 's'} recorded · ${s.activeMembers} active members`} />
            <Tile label="Visitors" value={visitors} sub="All Sundays in this period" />
            <Tile label="First-timers" value={firstTimers} sub="All Sundays in this period" />
          </div>

          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Sunday attendance</h2>
            {sundays.length ? (
              <>
                {sundays.length > 1 && <SundayTrend data={sundays} />}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-max text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-4 font-medium">Sunday</th>
                        <th className="py-2 pr-4 text-right font-medium">Members</th>
                        <th className="py-2 pr-4 text-right font-medium">Visitors</th>
                        <th className="py-2 pr-4 text-right font-medium">First-timers</th>
                        {s.constituencies.map((c) => (
                          <th key={c.id} className="py-2 pr-4 text-right font-medium">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border tabular-nums">
                      {[...sundays].reverse().map((x) => (
                        <tr key={x.id} className="hover:bg-surface-2">
                          <td className="py-2 pr-4">
                            <Link href={`/church/attendance/take?kind=SUNDAY_SERVICE&date=${x.date}`} className="hover:text-brand">
                              {formatDay(x.date)}
                            </Link>
                          </td>
                          <td className="py-2 pr-4 text-right font-medium">{x.present}</td>
                          <td className="py-2 pr-4 text-right">{x.visitors}</td>
                          <td className="py-2 pr-4 text-right">{x.firstTimers}</td>
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
              </>
            ) : (
              <p className="text-sm text-muted">No Sunday attendance recorded in this period.</p>
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
            <p className="mb-3 text-xs text-muted">Active members not marked present at any Sunday service or group meeting between these dates.</p>
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
              <p className="text-sm text-muted">{sundays.length ? 'Everyone was seen at least once.' : 'Record some attendance to see who needs a follow-up.'}</p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
