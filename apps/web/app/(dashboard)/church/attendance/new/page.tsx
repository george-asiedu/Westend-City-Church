'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { MEETING_TYPE_SUGGESTIONS, SERVICE_TYPE_SUGGESTIONS } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { lastSunday, localDate, useGroups } from '@/lib/membership';

function NewSession() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const groups = useGroups();
  const mine = (groups.data ?? []).filter((g) => g.canManage && g.isActive);
  const canChurch = !!me.data?.permissions.canRecordSunday;
  const [groupId, setGroupId] = useState(params.get('groupId') ?? '');
  const [serviceType, setServiceType] = useState('');
  const [custom, setCustom] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(params.get('date') ?? '');

  // Sensible defaults once we know what the user can record.
  useEffect(() => {
    if (!me.data || !groups.data) return;
    if (!groupId && !canChurch && mine[0]) setGroupId(mine[0].id);
  }, [me.data, groups.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const isGroup = !!groupId;
  const suggestions = isGroup ? MEETING_TYPE_SUGGESTIONS : SERVICE_TYPE_SUGGESTIONS;
  useEffect(() => {
    setServiceType(suggestions[0]!);
    if (!params.get('date')) setDate(isGroup ? localDate() : lastSunday());
  }, [isGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  const type = serviceType === '__other' ? custom.trim() : serviceType;
  const open = useMutation({
    mutationFn: () => api<{ id: string; created: boolean }>('/attendance/sessions', { method: 'POST', body: { groupId: groupId || null, serviceType: type, title: title.trim() || null, date } }),
    onSuccess: (r) => {
      if (!r.created) toast.info('That was already recorded, opening it.');
      router.replace(`/church/attendance/s/${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (me.isLoading || groups.isLoading) return <PageLoader />;
  if (!canChurch && !mine.length) return <EmptyState title="You can’t record attendance yet">Pastors record church services; group leaders record their group’s meetings.</EmptyState>;

  return (
    <>
      <PageHeader title="Record attendance" subtitle="Services, all-nights, camps, conferences or group meetings.">
        <Link href="/church/attendance" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Attendance
        </Link>
      </PageHeader>
      <Card className="max-w-xl p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            open.mutate();
          }}
        >
          <Field label="For" htmlFor="ns-for">
            <Select id="ns-for" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {canChurch && <option value="">The whole church</option>}
              {mine.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.type === 'CONSTITUENCY' ? 'constituency' : 'basonta'})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What is it?" htmlFor="ns-type">
            <Select id="ns-type" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {suggestions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__other">Something else…</option>
            </Select>
          </Field>
          {serviceType === '__other' && (
            <Field label="Name it" htmlFor="ns-custom">
              <Input id="ns-custom" required minLength={2} maxLength={40} placeholder="e.g. Easter convention" value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />
            </Field>
          )}
          <Field label="Title (optional)" htmlFor="ns-title" hint="To tell apart two of the same on one day, e.g. “1st service”, “Day 2”.">
            <Input id="ns-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Date" htmlFor="ns-date">
            <Input id="ns-date" type="date" required max={localDate()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Button type="submit" loading={open.isPending} disabled={type.length < 2 || !date}>
            Open attendance sheet
          </Button>
        </form>
      </Card>
    </>
  );
}

export default function NewSessionPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewSession />
    </Suspense>
  );
}
