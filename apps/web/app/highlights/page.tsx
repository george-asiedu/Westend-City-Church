'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { formatEventDate } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, PageLoader } from '@/components/ui/misc';
import { api, ApiError } from '@/lib/api';

interface Highlight {
  id: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  event: { title: string; date: string; category: string };
}

/** Public highlights (§19): only admin-chosen items. Embeddable from the church website by linking here. */
export default function HighlightsPage() {
  const q = useInfiniteQuery({
    queryKey: ['highlights'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ items: Highlight[]; nextCursor: string | null }>('/public/highlights', { anonymous: true, query: { cursor: pageParam, limit: 60 } }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">Highlights</h1>
      <p className="mb-8 text-muted">Westend City Church · The Life Cathedral</p>
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <EmptyState title={q.error instanceof ApiError && q.error.status === 404 ? 'Highlights are not published' : 'Could not load highlights'} />
      ) : (
        <div className="columns-2 gap-3 sm:columns-3 lg:columns-4">
          {items.map((m) => (
            <figure key={m.id} className="mb-3 break-inside-avoid overflow-hidden rounded-xl bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.previewUrl ?? m.thumbUrl ?? ''} alt={m.caption ?? m.event.title} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" className="h-auto w-full" />
              <figcaption className="p-3 text-xs text-muted">
                {m.caption && <span className="block text-sm text-fg">{m.caption}</span>}
                {m.event.title} · {formatEventDate(m.event.date)}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {q.hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </main>
  );
}
