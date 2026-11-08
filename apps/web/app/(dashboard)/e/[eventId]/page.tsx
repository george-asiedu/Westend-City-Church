'use client';

import { use, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, MoreHorizontal, Package, Pencil, RotateCcw, Share2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { formatBytes, type MediaDto, type Paginated } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState, PageLoader } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { Dialog } from '@/components/ui/dialog';
import { MediaGrid } from '@/components/gallery/media-grid';
import { MediaLightbox } from '@/components/gallery/lightbox';
import { SelectionBar } from '@/components/gallery/selection-bar';
import { EventFormDialog } from '@/components/events/event-form';
import { ShareDialog } from '@/components/share/share-dialog';
import { api, errorMessage } from '@/lib/api';
import { qk, useCategories, useEvent, useMe } from '@/lib/queries';
import { cn, eventDateRange, monthName } from '@/lib/utils';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'IMAGE', label: 'Photos' },
  { id: 'VIDEO', label: 'Videos' },
  { id: 'featured', label: 'Featured' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const categories = useCategories();
  const event = useEvent(eventId);
  const [tab, setTab] = useState<TabId>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(-1);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filters = { type: tab === 'IMAGE' || tab === 'VIDEO' ? tab : undefined, featured: tab === 'featured' || undefined };
  const media = useInfiniteQuery({
    queryKey: qk.media(eventId, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<Paginated<MediaDto>>(`/events/${eventId}/media`, { query: { ...filters, cursor: pageParam, limit: 120 } }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    // Poll while anything is still uploading/processing (§8.1).
    refetchInterval: (q) =>
      q.state.data?.pages.some((p) => p.items.some((m) => m.status !== 'READY' && m.status !== 'FAILED')) ? 3000 : false,
  });
  const items = useMemo(() => media.data?.pages.flatMap((p) => p.items) ?? [], [media.data]);
  const ready = useMemo(() => items.filter((m) => m.status === 'READY'), [items]);
  const failed = items.filter((m) => m.status === 'FAILED');

  const toggle = useCallback(
    (id: string, range?: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (range && lastClicked) {
          const a = items.findIndex((m) => m.id === lastClicked);
          const b = items.findIndex((m) => m.id === id);
          for (const m of items.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(m.id);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastClicked(id);
    },
    [items, lastClicked],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['media', eventId] });
    void qc.invalidateQueries({ queryKey: qk.event(eventId) });
  };

  if (event.isLoading) return <PageLoader />;
  if (event.isError) return <EmptyState title="Event not found">{errorMessage(event.error)}</EmptyState>;
  const e = event.data!;
  const year = e.eventDate.slice(0, 4);
  const month = Number(e.eventDate.slice(5, 7));

  return (
    <>
      <nav className="mb-2 truncate text-sm text-muted" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">
          Home
        </Link>{' '}
        /{' '}
        <Link href={`/c/${e.category.slug}`} className="hover:underline">
          {e.category.name}
        </Link>{' '}
        / {year} / {monthName(month)}
      </nav>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{e.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{eventDateRange(e.eventDate, e.endDate)}</span>
            {e.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {e.location}
              </span>
            )}
            <span>
              {e.photoCount} photos · {e.videoCount} videos · {formatBytes(e.totalBytes)}
            </span>
            {e.programType && <Badge>{e.programType}</Badge>}
            {e.status === 'DRAFT' && <Badge tone="warning">Draft</Badge>}
          </p>
          {e.description && <p className="mt-2 max-w-2xl whitespace-pre-line text-sm">{e.description}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {e.canUpload && (
            <Link href={`/e/${e.id}/upload`}>
              <Button>
                <Upload className="h-4 w-4" /> Upload
              </Button>
            </Link>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                disabled={!ready.length}
                onSelect={() =>
                  api('/exports', { method: 'POST', body: { eventId: e.id } })
                    .then(() => toast.success('Preparing the ZIP. Find it under Downloads.'))
                    .catch((err) => toast.error(errorMessage(err)))
                }
              >
                <Package className="h-4 w-4" /> Download all (ZIP)
              </MenuItem>
              {e.canShare && (
                <MenuItem onSelect={() => setSharing(true)}>
                  <Share2 className="h-4 w-4" /> Share link…
                </MenuItem>
              )}
              {e.canEdit && (
                <MenuItem onSelect={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Edit details
                </MenuItem>
              )}
              {e.canDelete && (
                <MenuItem danger onSelect={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" /> Delete event
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => (setTab(t.id), setSelected(new Set()))}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-brand font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
          </button>
        ))}
        {items.length > 0 && (
          <button className="ml-auto whitespace-nowrap px-3 py-2 text-sm text-brand" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((m) => m.id)))}>
            {selected.size === items.length ? 'Select none' : 'Select all'}
          </button>
        )}
      </div>

      {failed.length > 0 && me.data?.permissions.isAdmin && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-4 py-3 text-sm">
          <span>{failed.length} item(s) failed to process.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              for (const m of failed) await api(`/media/${m.id}/reprocess`, { method: 'POST' }).catch(() => undefined);
              toast.success('Retrying processing');
              refresh();
            }}
          >
            <RotateCcw className="h-4 w-4" /> Retry processing
          </Button>
        </div>
      )}

      {media.isLoading ? (
        <PageLoader />
      ) : items.length === 0 ? (
        <EmptyState title="No media here yet">{e.canUpload ? <Link className="text-brand hover:underline" href={`/e/${e.id}/upload`}>Upload photos and videos</Link> : null}</EmptyState>
      ) : (
        <MediaGrid
          items={items}
          selected={selected}
          selecting={selected.size > 0}
          onToggle={toggle}
          onOpen={(i) => setLightbox(ready.findIndex((m) => m.id === items[i]?.id))}
          onEndReached={() => media.hasNextPage && !media.isFetchingNextPage && void media.fetchNextPage()}
        />
      )}

      {lightbox >= 0 && (
        <MediaLightbox items={ready} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(-1)} eventId={e.id} canEditEvent={!!e.canEdit} onDeleted={() => (setLightbox(-1), refresh())} />
      )}
      {selected.size > 0 && (
        <SelectionBar eventId={e.id} eventTitle={e.title} selected={[...selected]} canShare={!!e.canShare} onClear={() => setSelected(new Set())} onDone={() => (setSelected(new Set()), refresh())} />
      )}
      {categories.data && <EventFormDialog open={editing} onOpenChange={setEditing} categories={categories.data} event={e} />}
      <ShareDialog open={sharing} onOpenChange={setSharing} eventId={e.id} defaultTitle={e.title} />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this event?"
        description={`The event and its ${e.mediaCount} items go to the Trash for 30 days.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                api(`/events/${e.id}`, { method: 'DELETE' })
                  .then(() => {
                    toast.success('Event moved to Trash');
                    void qc.invalidateQueries({ queryKey: ['events'] });
                    router.push(`/c/${e.category.slug}`);
                  })
                  .catch((err) => toast.error(errorMessage(err)))
              }
            >
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
