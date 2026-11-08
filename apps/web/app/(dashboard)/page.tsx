'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Plus } from 'lucide-react';
import { formatEventDate, type EventDto, type Paginated } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { EventGrid } from '@/components/events/event-card';
import { api } from '@/lib/api';
import { qk, useCategories, useMe } from '@/lib/queries';

export default function HomePage() {
  const me = useMe();
  const categories = useCategories();
  const recent = useQuery({ queryKey: qk.events({ recent: true }), queryFn: () => api<Paginated<EventDto>>('/events', { query: { limit: 12 } }) });

  return (
    <>
      <PageHeader
        title={`Welcome${me.data ? `, ${me.data.title ? `${me.data.title} ` : ''}${me.data.fullName.split(' ')[0]}` : ''}`}
        subtitle="Photos and videos from every service and event."
        actions={
          me.data?.permissions.canUploadAnywhere && (
            <Link href="/add">
              <Button>
                <Plus className="h-4 w-4" /> Add media
              </Button>
            </Link>
          )
        }
      />
      <form action="/search" className="mb-6 md:hidden">
        <input name="q" placeholder="Search events, captions, tags…" className="h-11 w-full rounded-lg border border-border bg-surface px-3" />
      </form>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Folders</h2>
      {categories.isLoading ? (
        <PageLoader />
      ) : (
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6">
          {categories.data
            ?.filter((c) => c.isActive)
            .map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="group overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
                <div className="relative aspect-[16/10] bg-surface-2">
                  {c.coverThumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.coverThumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      <FolderOpen className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted">
                    {c.eventCount} {c.eventCount === 1 ? 'event' : 'events'}
                    {c.latestEventDate ? ` · ${formatEventDate(c.latestEventDate)}` : ''}
                  </p>
                </div>
              </Link>
            ))}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Recent events</h2>
      {recent.isLoading ? <PageLoader /> : recent.data?.items.length ? <EventGrid events={recent.data.items} showCategory /> : <EmptyState title="No events yet">Create one with “Add media”.</EmptyState>}
    </>
  );
}
