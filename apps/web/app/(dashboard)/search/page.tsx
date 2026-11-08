'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { EventDto, MediaDto } from '@wcc/shared';
import { Input, Select } from '@/components/ui/form';
import { EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { EventGrid } from '@/components/events/event-card';
import { MediaLightbox } from '@/components/gallery/lightbox';
import { api } from '@/lib/api';
import { qk, useCategories } from '@/lib/queries';

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const categories = useCategories();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(-1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      router.replace(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
    }, 300);
    return () => clearTimeout(t);
  }, [q, router]);

  const filters = { q: debounced, categoryId: categoryId || undefined, type: type || undefined, from: from || undefined, to: to || undefined };
  const results = useQuery({
    queryKey: qk.search(filters),
    enabled: debounced.length >= 2,
    queryFn: () => api<{ events: EventDto[]; media: MediaDto[] }>('/search', { query: filters }),
  });

  return (
    <>
      <PageHeader title="Search" />
      <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input className="lg:col-span-2" autoFocus placeholder="Titles, captions, file names, tags…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Folder">
          <option value="">All folders</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Photos & videos</option>
          <option value="IMAGE">Photos</option>
          <option value="VIDEO">Videos</option>
        </Select>
        <div className="flex gap-2">
          <Input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {debounced.length < 2 ? (
        <EmptyState title="Type at least two characters" />
      ) : results.isLoading ? (
        <PageLoader />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Events ({results.data?.events.length ?? 0})</h2>
            {results.data?.events.length ? <EventGrid events={results.data.events} showCategory /> : <p className="text-sm text-muted">No matching events.</p>}
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Media ({results.data?.media.length ?? 0})</h2>
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:grid-cols-8">
              {results.data?.media.map((m, i) => (
                <button key={m.id} onClick={() => setOpen(i)} className="aspect-square overflow-hidden rounded-md bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.thumbUrl && <img src={m.thumbUrl} alt={m.caption || m.originalFilename} loading="lazy" className="h-full w-full object-cover" />}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {open >= 0 && results.data && (
        <MediaLightbox items={results.data.media} index={open} onIndex={setOpen} onClose={() => setOpen(-1)} eventId={results.data.media[open]?.eventId ?? ''} canEditEvent={false} onDeleted={() => (setOpen(-1), void results.refetch())} />
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchInner />
    </Suspense>
  );
}
