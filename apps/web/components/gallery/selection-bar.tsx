'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FolderInput, Package, Share2, Star, StarOff, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { EventDto, Paginated } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { ShareDialog } from '@/components/share/share-dialog';
import { api, errorMessage } from '@/lib/api';
import { useCategories } from '@/lib/queries';
import { eventDateRange } from '@/lib/utils';

type BulkAction = 'delete' | 'move' | 'tag' | 'untag' | 'feature' | 'unfeature';

function MoveDialog({ open, onOpenChange, currentEventId, onMove }: { open: boolean; onOpenChange: (o: boolean) => void; currentEventId: string; onMove: (targetEventId: string) => void }) {
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const events = useQuery({
    queryKey: ['move-targets', categoryId, q],
    enabled: open && !!categoryId,
    queryFn: () => api<Paginated<EventDto>>('/events', { query: { categoryId, q: q || undefined, limit: 30 } }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Move to another event">
      <div className="space-y-3">
        <Field label="Folder" htmlFor="mv-cat">
          <Select id="mv-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose…</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {categoryId && <Input placeholder="Filter events" value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {events.data?.items
            .filter((e) => e.id !== currentEventId)
            .map((e) => (
              <button key={e.id} onClick={() => onMove(e.id)} className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-brand">
                <span className="font-medium">{e.title}</span>
                <span className="block text-xs text-muted">{eventDateRange(e.eventDate, e.endDate)}</span>
              </button>
            ))}
        </div>
      </div>
    </Dialog>
  );
}

export function SelectionBar({
  eventId,
  eventTitle,
  selected,
  canShare,
  onClear,
  onDone,
}: {
  eventId: string;
  eventTitle: string;
  selected: string[];
  canShare: boolean;
  onClear: () => void;
  onDone: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [tagging, setTagging] = useState<null | 'tag' | 'untag'>(null);
  const [tags, setTags] = useState('');
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bulk = useMutation({
    mutationFn: (body: { action: BulkAction; targetEventId?: string; tags?: string[] }) =>
      api<{ succeeded: string[]; failed: Array<{ id: string; code: string }> }>('/media/bulk', { method: 'POST', body: { ...body, mediaIds: selected } }),
    onSuccess: (r, v) => {
      const verb = { delete: 'Moved to Trash', move: 'Moved', tag: 'Tagged', untag: 'Untagged', feature: 'Featured', unfeature: 'Unfeatured' }[v.action];
      if (r.failed.length) toast.warning(`${verb} ${r.succeeded.length}; ${r.failed.length} not allowed`);
      else toast.success(`${verb} ${r.succeeded.length} item${r.succeeded.length === 1 ? '' : 's'}`);
      setMoving(false);
      setTagging(null);
      setConfirmDelete(false);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const zip = useMutation({
    mutationFn: () => api('/exports', { method: 'POST', body: { mediaIds: selected } }),
    onSuccess: () => toast.success('Preparing your ZIP. Find it under Downloads; we will email you too.'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <div className="fixed inset-x-0 bottom-16 z-40 px-3 lg:bottom-4">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-1 rounded-2xl border border-border bg-surface p-2 shadow-xl">
          <button onClick={onClear} className="rounded-lg p-2 hover:bg-surface-2" aria-label="Clear selection">
            <X className="h-4 w-4" />
          </button>
          <span className="mr-auto px-1 text-sm font-medium">{selected.length} selected</span>
          <Button size="sm" variant="ghost" onClick={() => zip.mutate()} loading={zip.isPending} title="Download as ZIP">
            <Package className="h-4 w-4" /> <span className="hidden sm:inline">ZIP</span>
          </Button>
          {canShare && (
            <Button size="sm" variant="ghost" onClick={() => setSharing(true)} title="Share link">
              <Share2 className="h-4 w-4" /> <span className="hidden sm:inline">Share</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMoving(true)} title="Move">
            <FolderInput className="h-4 w-4" /> <span className="hidden sm:inline">Move</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTagging('tag')} title="Tag">
            <Tag className="h-4 w-4" /> <span className="hidden sm:inline">Tag</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ action: 'feature' })} title="Feature">
            <Star className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ action: 'unfeature' })} title="Unfeature">
            <StarOff className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <MoveDialog open={moving} onOpenChange={setMoving} currentEventId={eventId} onMove={(targetEventId) => bulk.mutate({ action: 'move', targetEventId })} />
      <Dialog
        open={!!tagging}
        onOpenChange={(o) => !o && setTagging(null)}
        title={tagging === 'untag' ? 'Remove tags' : 'Add tags'}
        footer={
          <>
            <Button variant="outline" onClick={() => setTagging(tagging === 'tag' ? 'untag' : 'tag')}>
              {tagging === 'tag' ? 'Remove tags instead' : 'Add tags instead'}
            </Button>
            <Button loading={bulk.isPending} onClick={() => bulk.mutate({ action: tagging!, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })}>
              Apply
            </Button>
          </>
        }
      >
        <Input autoFocus placeholder="Bishop, Choir, Baptism" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selected.length} item${selected.length === 1 ? '' : 's'}?`}
        description="They go to the Trash and can be restored for 30 days."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={bulk.isPending} onClick={() => bulk.mutate({ action: 'delete' })}>
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
      <ShareDialog open={sharing} onOpenChange={setSharing} mediaIds={selected} defaultTitle={eventTitle} />
    </>
  );
}
