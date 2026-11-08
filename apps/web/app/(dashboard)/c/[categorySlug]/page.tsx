'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { EventDto, Paginated } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { EventGrid } from '@/components/events/event-card';
import { EventFormDialog } from '@/components/events/event-form';
import { api, errorMessage } from '@/lib/api';
import { qk, useCategories, type CategoryDetail } from '@/lib/queries';
import { cn, monthName } from '@/lib/utils';

interface Timeline {
  year: number;
  months: Array<{ month: number; eventCount: number }>;
}

export default function CategoryPage({ params }: { params: Promise<{ categorySlug: string }> }) {
  const { categorySlug } = use(params);
  const categories = useCategories();
  const category = useQuery({ queryKey: qk.category(categorySlug), queryFn: () => api<CategoryDetail>(`/categories/${categorySlug}`) });
  const timeline = useQuery({ queryKey: qk.timeline(categorySlug), queryFn: () => api<Timeline[]>(`/categories/${categorySlug}/timeline`) });
  const [year, setYear] = useState<number | undefined>();
  const [month, setMonth] = useState<number | undefined>();
  const [q, setQ] = useState('');
  const [programType, setProgramType] = useState('');
  const [openYears, setOpenYears] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);

  const filters = { categoryId: category.data?.id, year, month, q: q.trim() || undefined, programType: programType || undefined };
  const events = useInfiniteQuery({
    queryKey: qk.events(filters),
    enabled: !!category.data,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Paginated<EventDto>>('/events', { query: { ...filters, cursor: pageParam, limit: 48 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  // Group the loaded events under "Month Year" headings.
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: EventDto[] }> = [];
    for (const e of events.data?.pages.flatMap((p) => p.items) ?? []) {
      const label = `${monthName(Number(e.eventDate.slice(5, 7)))} ${e.eventDate.slice(0, 4)}`;
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  }, [events.data]);

  if (category.isLoading) return <PageLoader />;
  if (category.isError) return <EmptyState title="Folder not found">{errorMessage(category.error)}</EmptyState>;
  const c = category.data!;

  const Tree = (
    <nav className="space-y-1 text-sm" aria-label="Years and months">
      <button onClick={() => (setYear(undefined), setMonth(undefined))} className={cn('w-full rounded-lg px-3 py-1.5 text-left hover:bg-surface-2', !year && 'bg-surface-2 font-medium')}>
        All dates
      </button>
      {timeline.data?.map((y) => {
        const open = openYears.has(y.year) || year === y.year;
        const total = y.months.reduce((s, m) => s + m.eventCount, 0);
        return (
          <div key={y.year}>
            <button
              onClick={() => {
                setOpenYears((s) => new Set(s.has(y.year) ? [...s].filter((v) => v !== y.year) : [...s, y.year]));
                setYear(y.year);
                setMonth(undefined);
              }}
              className={cn('flex w-full items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-2', year === y.year && !month && 'bg-surface-2 font-medium')}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {y.year}
              <span className="ml-auto text-xs text-muted">{total}</span>
            </button>
            {open &&
              y.months.map((m) => (
                <button
                  key={m.month}
                  onClick={() => (setYear(y.year), setMonth(m.month))}
                  className={cn('flex w-full items-center rounded-lg py-1.5 pl-8 pr-3 hover:bg-surface-2', year === y.year && month === m.month && 'bg-surface-2 font-medium')}
                >
                  {monthName(m.month)}
                  <span className="ml-auto text-xs text-muted">{m.eventCount}</span>
                </button>
              ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={c.description}
        actions={
          c.canUpload && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New event
            </Button>
          )
        }
      >
        <p className="mb-1 text-sm text-muted">
          <Link href="/" className="hover:underline">
            Home
          </Link>{' '}
          / {c.name}
          {year ? ` / ${year}` : ''}
          {month ? ` / ${monthName(month)}` : ''}
        </p>
      </PageHeader>

      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="md:w-48 md:shrink-0">
          <details className="rounded-[var(--radius)] border border-border bg-surface p-2 md:hidden">
            <summary className="cursor-pointer px-2 py-1 text-sm font-medium">{year ? `${month ? `${monthName(month)} ` : ''}${year}` : 'All dates'}</summary>
            <div className="mt-2">{Tree}</div>
          </details>
          <div className="hidden md:block">{Tree}</div>
        </aside>
        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input placeholder={`Search in ${c.name}`} value={q} onChange={(e) => setQ(e.target.value)} />
            {c.allowsMultiDay && <Input placeholder="Program type (e.g. Funeral)" value={programType} onChange={(e) => setProgramType(e.target.value)} className="sm:max-w-56" />}
          </div>
          {events.isLoading ? (
            <PageLoader />
          ) : groups.length === 0 ? (
            <EmptyState title="No events here yet">{c.canUpload ? 'Create the first one with “New event”.' : null}</EmptyState>
          ) : (
            groups.map((g) => (
              <section key={g.label}>
                <h2 className="mb-3 text-sm font-semibold text-muted">{g.label}</h2>
                <EventGrid events={g.items} />
              </section>
            ))
          )}
          {events.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" loading={events.isFetchingNextPage} onClick={() => events.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
      {categories.data && <EventFormDialog open={creating} onOpenChange={setCreating} categories={categories.data.filter((x) => x.isActive)} defaultCategoryId={c.id} />}
    </>
  );
}
