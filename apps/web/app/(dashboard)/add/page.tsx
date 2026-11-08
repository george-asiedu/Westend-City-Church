'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, FolderOpen, Plus } from 'lucide-react';
import { formatEventDate, type EventDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { EventFormDialog } from '@/components/events/event-form';
import { api } from '@/lib/api';
import { useCategories, useMe } from '@/lib/queries';
import { todayIso } from '@/lib/utils';

/** "Add media" wizard (§11.3.5): category → date → existing event or new → upload. */
export default function AddMediaPage() {
  const router = useRouter();
  const me = useMe();
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [creating, setCreating] = useState(false);

  const allowed =
    categories.data?.filter((c) => c.isActive && (me.data?.permissions.isAdmin || me.data?.grants.some((g) => g.categoryId === c.id && g.canUpload))) ?? [];
  const category = allowed.find((c) => c.id === categoryId);
  const existing = useQuery({
    queryKey: ['lookup', categoryId, date],
    enabled: step === 3 && !!categoryId,
    queryFn: () => api<EventDto[]>('/events/lookup', { query: { categoryId: categoryId!, date } }),
  });

  if (categories.isLoading || me.isLoading) return <PageLoader />;
  if (!allowed.length) return <EmptyState title="You cannot upload yet">Ask an admin to grant you upload access to a folder.</EmptyState>;

  return (
    <>
      <PageHeader title="Add media" subtitle={`Step ${step} of 3`}>
        {step > 1 && (
          <button onClick={() => setStep((s) => (s - 1) as 1 | 2)} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
      </PageHeader>

      {step === 1 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {allowed.map((c) => (
            <button key={c.id} onClick={() => (setCategoryId(c.id), setStep(2))} className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-surface p-4 text-left hover:border-brand">
              <FolderOpen className="h-5 w-5 text-brand" />
              <span className="font-medium">{c.name}</span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && category && (
        <Card className="max-w-md space-y-4 p-5">
          <p className="text-sm text-muted">{category.name}</p>
          <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4" /> {category.allowsMultiDay ? 'Start date' : 'Service date'}
            </span>
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Button className="w-full justify-center" disabled={!date} onClick={() => setStep(3)}>
            Continue
          </Button>
        </Card>
      )}

      {step === 3 && category && (
        <div className="max-w-xl space-y-3">
          <p className="text-sm text-muted">
            {category.name} · {formatEventDate(date)}
          </p>
          {existing.isLoading ? (
            <PageLoader />
          ) : (
            <>
              {existing.data?.filter((e) => e.canUpload).map((e) => (
                <button key={e.id} onClick={() => router.push(`/e/${e.id}/upload`)} className="flex w-full items-center justify-between rounded-[var(--radius)] border border-border bg-surface p-4 text-left hover:border-brand">
                  <span>
                    <span className="block font-medium">{e.title}</span>
                    <span className="text-xs text-muted">
                      {e.photoCount} photos · {e.videoCount} videos
                    </span>
                  </span>
                  <span className="text-sm text-brand">Add here →</span>
                </button>
              ))}
              {!!existing.data?.length && <p className="pt-2 text-center text-xs text-muted">or</p>}
              <Button variant={existing.data?.length ? 'outline' : 'primary'} className="w-full justify-center" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New event on this date
              </Button>
            </>
          )}
        </div>
      )}

      {categories.data && (
        <EventFormDialog
          open={creating}
          onOpenChange={setCreating}
          categories={allowed}
          defaultCategoryId={categoryId ?? undefined}
          defaultDate={date}
          onSaved={(e) => router.push(`/e/${e.id}/upload`)}
        />
      )}
    </>
  );
}
