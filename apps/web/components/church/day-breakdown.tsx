'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/queries';
import { BellRing, ChevronDown } from 'lucide-react';
import type { DayRollupDto } from '@wcc/shared';
import { Input } from '@/components/ui/form';
import { Badge, Card, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { addDays, formatDay, localDate } from '@/lib/membership';
import { cn } from '@/lib/utils';

/** Most recent Saturday and Sunday on or before today. */
function lastWeekend(): { saturday: string; sunday: string } {
  const today = localDate();
  const dow = new Date(`${today}T12:00:00`).getDay(); // 0 = Sunday
  const sunday = dow === 0 ? today : addDays(today, -dow);
  const saturday = dow === 6 ? today : addDays(sunday, -1);
  return { saturday, sunday: sunday > today ? addDays(sunday, -7) : sunday };
}

/**
 * One day's attendance by constituency, each the sum of its basontas. Super Admins see
 * the whole church; leaders see their own constituency/basontas.
 */
export function DayBreakdown() {
  const wk = lastWeekend();
  const [date, setDate] = useState(wk.sunday > wk.saturday ? wk.sunday : wk.saturday);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['attendance', 'day', date], queryFn: () => api<DayRollupDto>('/attendance/day', { query: { date } }), placeholderData: keepPreviousData });
  const r = q.data;
  const max = Math.max(1, ...(r?.constituencies.map((c) => c.present ?? 0) ?? []));
  const missing = r?.constituencies.reduce((a, c) => a + c.basontas.filter((b) => b.present === null).length, 0) ?? 0;
  const me = useMe();
  const canRemind = !!me.data?.permissions.canManageMembership;
  const remind = useMutation({
    mutationFn: (groupIds: string[]) =>
      api<{ basontas: number; leaders: number; withDevices: number; noLeader: string[] }>('/attendance/remind', { method: 'POST', body: { date, groupIds } }),
    onSuccess: (x) => {
      if (!x.basontas) return toast.info('They’ve all recorded now.');
      const parts = [`Asked ${x.leaders} leader${x.leaders === 1 ? '' : 's'} of ${x.basontas} basonta${x.basontas === 1 ? '' : 's'}.`];
      if (x.leaders > x.withDevices) parts.push(`${x.leaders - x.withDevices} haven’t turned notifications on.`);
      if (x.noLeader.length) parts.push(`No pastor or shepherd for: ${x.noLeader.join(', ')}.`);
      toast.success(parts.join(' '), { duration: 8000 });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const allMissing = r?.constituencies.flatMap((c) => c.basontas.filter((b) => b.present === null).map((b) => b.id)) ?? [];

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 className="font-semibold">By constituency</h2>
          <p className="text-xs text-muted">Each constituency is the sum of its basontas’ attendance that day.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
          {(
            [
              ['Saturday', wk.saturday],
              ['Sunday', wk.sunday],
            ] as const
          ).map(([label, d]) => (
            <button key={label} onClick={() => setDate(d)} aria-pressed={date === d} className={cn('rounded-md px-3 py-1', date === d ? 'bg-brand text-white' : 'text-muted hover:text-fg')}>
              {label}
            </button>
          ))}
        </div>
        <Input type="date" className="w-40" aria-label="Date" max={localDate()} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>

      {q.error ? (
        <p className="text-sm text-danger">{errorMessage(q.error)}</p>
      ) : !r ? (
        <PageLoader />
      ) : (
        <>
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{r.total}</span> <span className="text-muted">present in basontas on {formatDay(r.date)}</span>
            {missing > 0 && (
              <Badge tone="warning" className="ml-2">
                {missing} basonta{missing === 1 ? '' : 's'} not recorded
              </Badge>
            )}
          </p>
          {canRemind && missing > 0 && (
            <Button size="sm" variant="outline" loading={remind.isPending && remind.variables?.length === allMissing.length} onClick={() => remind.mutate(allMissing)}>
              <BellRing className="h-4 w-4" /> Remind all {missing} to record
            </Button>
          )}
          {r.constituencies.length ? (
            <ul className="space-y-2">
              {r.constituencies.map((c) => (
                <li key={c.id} className="rounded-lg border border-border">
                  <button
                    className="grid w-full grid-cols-[minmax(0,10rem)_1fr_auto_auto] items-center gap-3 p-2.5 text-left text-sm sm:grid-cols-[minmax(0,14rem)_1fr_auto_auto]"
                    onClick={() => setOpen(open === c.id ? null : c.id)}
                    aria-expanded={open === c.id}
                  >
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="h-2.5 rounded-r-[4px] bg-[var(--viz-track)]">
                      <span className="block h-full rounded-r-[4px]" style={{ width: `${((c.present ?? 0) / max) * 100}%`, background: 'var(--viz-1)' }} />
                    </span>
                    <span className="text-right tabular-nums">
                      {c.present === null ? <span className="text-muted">not recorded</span> : <b>{c.present}</b>}
                      {c.basontas.length > 0 && c.missing > 0 && <span className="ml-1 text-xs text-warning">({c.missing} missing)</span>}
                    </span>
                    <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open === c.id && 'rotate-180')} />
                  </button>
                  {open === c.id && (
                    <ul className="divide-y divide-border border-t border-border px-3 text-sm">
                      {c.basontas.length ? (
                        c.basontas.map((b) => (
                          <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                            <Link href={`/church/groups/${b.id}`} className="min-w-0 truncate hover:text-brand">
                              {b.name}
                            </Link>
                            <span className="flex shrink-0 items-center gap-2 tabular-nums">
                              {b.present === null ? <Badge tone="warning">Not recorded</Badge> : `${b.present} of ${b.members}`}
                              {b.present === null && canRemind && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  loading={remind.isPending && remind.variables?.length === 1 && remind.variables[0] === b.id}
                                  onClick={() => remind.mutate([b.id])}
                                  aria-label={`Remind ${b.name}’s leaders to record attendance`}
                                >
                                  <BellRing className="h-3.5 w-3.5" /> Remind
                                </Button>
                              )}
                            </span>
                          </li>
                        ))
                      ) : (
                        <li className="py-2 text-muted">No basontas; this is the constituency’s own record.</li>
                      )}
                      <li className="py-2">
                        <Link href={`/church/groups/${c.id}`} className="text-xs text-brand hover:underline">
                          Open {c.name}
                        </Link>
                      </li>
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No constituencies to show.</p>
          )}
          {r.services.length > 0 && (
            <p className="text-xs text-muted">
              Church services that day: {r.services.map((s) => `${s.serviceType}${s.title ? ` (${s.title})` : ''} ${s.present}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
