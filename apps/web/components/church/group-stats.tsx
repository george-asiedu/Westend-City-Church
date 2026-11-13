'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Select } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { ColumnTrend, Doughnut, RankedBars } from '@/components/church/charts';
import { api, errorMessage } from '@/lib/api';
import { addDays, formatDay, localDate, mk, type GroupStats } from '@/lib/membership';

export const PERIODS = [
  { label: 'Last 4 weeks', days: 27 },
  { label: 'Last 3 months', days: 90 },
  { label: 'Last 6 months', days: 182 },
  { label: 'Last 12 months', days: 364 },
];

/** Charts for one group: meeting trend, last meeting, roles, people brought. */
export function GroupStatsPanel({ groupId, groupName }: { groupId: string; groupName?: string }) {
  const [days, setDays] = useState(90);
  const to = localDate();
  const from = addDays(to, -days);
  const q = useQuery({
    queryKey: mk.groupStats(groupId, { from, to }),
    queryFn: () => api<GroupStats>(`/groups/${groupId}/stats`, { query: { from, to } }),
    placeholderData: keepPreviousData,
  });
  const s = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">{groupName ? `${groupName}: statistics` : 'Statistics'}</h2>
        <Select className="w-44" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>
      {q.error && <p className="text-sm text-danger">{errorMessage(q.error)}</p>}
      {!s ? (
        q.isLoading && <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Members" value={s.members} />
            <Stat label="Meetings" value={s.meetings.length} sub={`avg ${s.averagePresent} present`} />
            <Stat label="At church services" value={s.churchServices.sessions ? s.churchServices.averagePresent : '—'} sub={s.churchServices.sessions ? `avg of ${s.churchServices.sessions} services` : 'No services recorded'} />
            <Stat label="People brought" value={s.guests.visit + s.guests.joining} sub={`${s.guests.converted} became members`} />
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">{s.sumOfBasontas ? 'Attendance (sum of its basontas)' : 'Attendance at meetings'}</h3>
              <ColumnTrend
                data={s.meetings.map((m) => ({ key: m.id, label: formatDay(m.date), detail: `${formatDay(m.date)} · ${m.serviceType}${m.title ? ` · ${m.title}` : ''}`, value: m.present }))}
              />
            </Card>
            <Card className="space-y-5 p-4">
              {s.lastMeeting ? (
                <Link href={s.sumOfBasontas ? '/church/attendance' : `/church/attendance/s/${s.lastMeeting.id}`} className="block">
                  <Doughnut
                    title={`${s.sumOfBasontas ? 'Latest day' : 'Last meeting'} · ${formatDay(s.lastMeeting.date)}`}
                    centerLabel="members"
                    slices={[
                      { label: 'Present', value: s.lastMeeting.present },
                      { label: 'Absent', value: s.lastMeeting.absent },
                    ]}
                  />
                </Link>
              ) : (
                <p className="text-sm text-muted">No meetings recorded in this period.</p>
              )}
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
          {s.teamRoles.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Members per team</h3>
              <RankedBars rows={s.teamRoles.map((r) => ({ key: r.id ?? 'none', label: r.name, value: r.count }))} unit="members" max={12} />
            </Card>
          )}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Roles in church</h3>
            <RankedBars rows={s.roles.map((r) => ({ key: r.role, label: r.role, value: r.count }))} empty="No members yet." />
          </Card>
        </>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </Card>
  );
}
