'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { daysUntil, formatDateTime } from '@/lib/utils';

interface TrashData {
  events: Array<{ id: string; title: string; categoryName: string; eventDate: string; mediaCount: number; deletedAt: string; purgeAfter: string | null }>;
  media: Array<{ id: string; type: string; originalFilename: string; event: { id: string; title: string }; deletedAt: string; purgeAfter: string | null; thumbUrl: string | null }>;
}

export default function TrashPage() {
  const me = useMe();
  const qc = useQueryClient();
  const trash = useQuery({ queryKey: qk.trash, queryFn: () => api<TrashData>('/trash') });
  const done = (msg: string) => {
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: qk.trash });
    void qc.invalidateQueries({ queryKey: ['events'] });
    void qc.invalidateQueries({ queryKey: ['media'] });
  };
  const act = useMutation({
    mutationFn: ({ path, method }: { path: string; method: 'POST' | 'DELETE'; msg: string }) => api(path, { method }),
    onSuccess: (_d, v) => done(v.msg),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canPurge = me.data?.permissions.canPurge;

  if (trash.isLoading) return <PageLoader />;
  const d = trash.data!;
  return (
    <>
      <PageHeader title="Trash" subtitle="Deleted items are kept for 30 days, then removed permanently." />
      {!d.events.length && !d.media.length && <EmptyState icon={<Trash2 className="h-8 w-8" />} title="Trash is empty" />}
      {d.events.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Events</h2>
          <div className="space-y-2">
            {d.events.map((e) => (
              <Card key={e.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-xs text-muted">
                    {e.categoryName} · {e.mediaCount} items · deleted {formatDateTime(e.deletedAt)}
                    {e.purgeAfter ? ` · ${daysUntil(e.purgeAfter)} days left` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ path: `/events/${e.id}/restore`, method: 'POST', msg: 'Event restored' })}>
                    <RotateCcw className="h-4 w-4" /> Restore
                  </Button>
                  {canPurge && (
                    <ConfirmButton size="sm" variant="danger" danger title="Delete forever?" description="This permanently removes the event and all its files. It cannot be undone." confirmLabel="Delete forever" onConfirm={() => act.mutateAsync({ path: `/trash/events/${e.id}`, method: 'DELETE', msg: 'Deleting permanently' })}>
                      Delete forever
                    </ConfirmButton>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
      {d.media.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Photos & videos</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {d.media.map((m) => (
              <Card key={m.id} className="overflow-hidden">
                <div className="relative aspect-square bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.thumbUrl && <img src={m.thumbUrl} alt={m.originalFilename} loading="lazy" className="h-full w-full object-cover opacity-80" />}
                  {m.type === 'VIDEO' && <Film className="absolute right-2 top-2 h-4 w-4 text-white drop-shadow" />}
                </div>
                <div className="space-y-2 p-2">
                  <p className="truncate text-xs text-muted" title={m.event.title}>
                    {m.event.title} · {daysUntil(m.purgeAfter)}d left
                  </p>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="flex-1 justify-center" onClick={() => act.mutate({ path: `/media/${m.id}/restore`, method: 'POST', msg: 'Restored' })}>
                      Restore
                    </Button>
                    {canPurge && (
                      <ConfirmButton size="sm" variant="ghost" danger title="Delete forever?" confirmLabel="Delete forever" aria-label="Delete forever" onConfirm={() => act.mutateAsync({ path: `/trash/media/${m.id}`, method: 'DELETE', msg: 'Deleting permanently' })}>
                        <Trash2 className="h-4 w-4 text-danger" />
                      </ConfirmButton>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
