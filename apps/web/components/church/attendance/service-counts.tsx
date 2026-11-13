'use client';

import { SelfCheckinCard } from '@/components/church/self-checkin';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SERVICE_TYPE_SUGGESTIONS,
  SUNDAY_SERVICE_TITLES,
  isPerServiceType,
  type AttendanceSheetDto,
} from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ConfirmButton, PageHeader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { formatDay, localDate, sessionName } from '@/lib/membership';
import { cn } from '@/lib/utils';

/** Church services: the ushers enter a head-count (total, of which visitors and new converts). */
export function ServiceCounts({
  sheet: s,
  onSaved,
}: {
  sheet: AttendanceSheetDto;
  onSaved: (r: AttendanceSheetDto) => void;
}) {
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
      toast.success(
        `Saved: ${n(f.total)} at ${r.session.serviceType}${r.session.title ? ` (${r.session.title})` : ''}`,
      );
      router.push('/church/attendance');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const num = (k: 'total' | 'visitors' | 'converts') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value.replace(/\D/g, '') });
  return (
    <div className="pb-10">
      <PageHeader title={sessionName(info)} subtitle={`${formatDay(info.date)} · church service head-count`}>
        <Link
          href="/church/attendance"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
        >
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
            {Math.max(0, (info.headcount ?? 0) - info.visitorCount - info.newConvertCount)} members ·{' '}
            {info.visitorCount} visitors · {info.newConvertCount} new converts
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
                <Input
                  id="sc-type"
                  list="sc-types"
                  maxLength={40}
                  value={f.serviceType}
                  onChange={(e) => setF({ ...f, serviceType: e.target.value })}
                />
                <datalist id="sc-types">
                  {SERVICE_TYPE_SUGGESTIONS.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              {sunday ? (
                <Field label="Which service" htmlFor="sc-title">
                  <Select
                    id="sc-title"
                    value={f.title}
                    onChange={(e) => setF({ ...f, title: e.target.value })}
                  >
                    {SUNDAY_SERVICE_TITLES.map((t) => (
                      <option key={t} value={t}>
                        {t[0]!.toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Title (optional)" htmlFor="sc-title">
                  <Input
                    id="sc-title"
                    maxLength={120}
                    value={f.title}
                    onChange={(e) => setF({ ...f, title: e.target.value })}
                  />
                </Field>
              )}
            </div>
            <Field label="Date" htmlFor="sc-date">
              <Input
                id="sc-date"
                type="date"
                max={localDate()}
                value={f.date}
                onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Field label="Total present" htmlFor="sc-total" hint="Everyone counted">
                <Input
                  id="sc-total"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={f.total}
                  onChange={num('total')}
                  autoFocus
                />
              </Field>
              <Field label="Visitors" htmlFor="sc-vis" hint="Of the total">
                <Input
                  id="sc-vis"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={f.visitors}
                  onChange={num('visitors')}
                />
              </Field>
              <Field label="New converts" htmlFor="sc-nc" hint="Of the total">
                <Input
                  id="sc-nc"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={f.converts}
                  onChange={num('converts')}
                />
              </Field>
            </div>
            <p
              className={cn('rounded-lg p-3 text-sm', invalid ? 'bg-danger/10 text-danger' : 'bg-surface-2')}
            >
              {invalid ? (
                'Visitors and new converts can’t add up to more than the total.'
              ) : (
                <>
                  Members: <b className="tabular-nums">{members}</b> · visitors {n(f.visitors)} · new converts{' '}
                  {n(f.converts)}
                </>
              )}
            </p>
            <Field label="Notes (optional)" htmlFor="sc-notes">
              <Textarea
                id="sc-notes"
                maxLength={1000}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
                className="min-h-16"
              />
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
