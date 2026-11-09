'use client';

import { toast } from 'sonner';
import { use, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Lightbox, { type Slide } from 'yet-another-react-lightbox';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import { Download, Film, Lock, Package } from 'lucide-react';
import { formatEventDate } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { api, API_BASE, ApiError, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

interface ShareView {
  title: string;
  eventDate: string | null;
  endDate: string | null;
  expiresAt: string;
  requiresPassword: boolean;
  unlocked: boolean;
  allowDownload: boolean;
}
interface ShareItem {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  width: number | null;
  height: number | null;
  caption: string | null;
  thumbUrl: string | null;
  previewUrl: string | null;
  posterUrl: string | null;
  playbackUrl: string | null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 py-8 safe-top">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={24} height={24} /> Westend City Church · The Life Cathedral
      </div>
      {children}
    </main>
  );
}

function ZipButton({ token }: { token: string }) {
  const [exportId, setExportId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api<{ exportId: string }>(`/public/shares/${token}/zip`, { method: 'POST', anonymous: true }),
    onSuccess: (r) => (setExportId(r.exportId), toast.info('Preparing your ZIP. This can take a few minutes.')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const status = useQuery({
    queryKey: ['share-zip', exportId],
    enabled: !!exportId,
    queryFn: () => api<{ status: string; downloadUrl: string | null; fileCount: number }>(`/public/shares/${token}/zip/${exportId}`, { anonymous: true }),
    refetchInterval: (q) => (q.state.data?.status === 'READY' || q.state.data?.status === 'FAILED' ? false : 4000),
  });
  if (status.data?.downloadUrl)
    return (
      <a href={status.data.downloadUrl}>
        <Button>
          <Download className="h-4 w-4" /> Download ZIP ({status.data.fileCount} files)
        </Button>
      </a>
    );
  if (status.data?.status === 'FAILED') return <p className="text-sm text-danger">The ZIP could not be prepared. Download items one by one instead.</p>;
  return (
    <Button variant="outline" loading={start.isPending || (!!exportId && !status.data?.downloadUrl)} onClick={() => start.mutate()}>
      <Package className="h-4 w-4" /> {exportId ? 'Preparing ZIP…' : 'Download all'}
    </Button>
  );
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [index, setIndex] = useState(-1);
  const view = useQuery({ queryKey: ['share', token], queryFn: () => api<ShareView>(`/public/shares/${token}`, { anonymous: true }), retry: false });
  const unlocked = !!view.data && (!view.data.requiresPassword || view.data.unlocked);
  const media = useInfiniteQuery({
    queryKey: ['share-media', token],
    enabled: unlocked,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api<{ items: ShareItem[]; nextCursor: string | null }>(`/public/shares/${token}/media`, { anonymous: true, query: { cursor: pageParam, limit: 120 } }),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const unlock = useMutation({
    mutationFn: () => api(`/public/shares/${token}/unlock`, { method: 'POST', anonymous: true, body: { password } }),
    onSuccess: () => (toast.success('Unlocked'), qc.invalidateQueries({ queryKey: ['share', token] })),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (view.isLoading) return <PageLoader />;
  if (view.isError) {
    const gone = view.error instanceof ApiError && (view.error.status === 410 || view.error.status === 404);
    return (
      <Shell>
        <Card className="mx-auto max-w-md p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold">{gone ? 'This link is no longer available' : 'Something went wrong'}</h1>
          <p className="text-sm text-muted">{gone ? 'It may have expired or been turned off. Ask the person who sent it for a new one.' : errorMessage(view.error)}</p>
        </Card>
      </Shell>
    );
  }
  const v = view.data!;

  if (!unlocked)
    return (
      <Shell>
        <Card className="mx-auto max-w-sm p-6">
          <Lock className="mb-3 h-6 w-6 text-muted" />
          <h1 className="mb-1 text-lg font-semibold">{v.title}</h1>
          <p className="mb-4 text-sm text-muted">Enter the password you were given.</p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              unlock.mutate();
            }}
          >
            <PasswordInput autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
            {unlock.isError && <p className="text-sm text-danger">{errorMessage(unlock.error)}</p>}
            <Button type="submit" className="w-full justify-center" loading={unlock.isPending}>
              View
            </Button>
          </form>
        </Card>
      </Shell>
    );

  const items = media.data?.pages.flatMap((p) => p.items) ?? [];
  const slides: Slide[] = items.map((m) =>
    m.type === 'VIDEO' && m.playbackUrl
      ? { type: 'video', poster: m.posterUrl ?? undefined, width: m.width ?? 1280, height: m.height ?? 720, sources: [{ src: m.playbackUrl, type: 'video/mp4' }] }
      : { src: m.previewUrl ?? m.thumbUrl ?? '', alt: m.caption ?? '', width: m.width ?? undefined, height: m.height ?? undefined },
  );
  const current = items[index];

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{v.title}</h1>
          <p className="text-sm text-muted">
            {v.eventDate ? formatEventDate(v.eventDate) : ''} {v.eventDate ? '· ' : ''}Link expires {formatDateTime(v.expiresAt)}
          </p>
        </div>
        {v.allowDownload && items.length > 0 && <ZipButton token={token} />}
      </div>
      {media.isLoading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((m, i) => (
            <button key={m.id} onClick={() => setIndex(i)} className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.thumbUrl && <img src={m.thumbUrl} alt={m.caption ?? 'Photo'} loading="lazy" className="h-full w-full object-cover" />}
              {m.type === 'VIDEO' && <Film className="absolute bottom-1 right-1 h-4 w-4 text-white drop-shadow" />}
            </button>
          ))}
        </div>
      )}
      {media.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" loading={media.isFetchingNextPage} onClick={() => media.fetchNextPage()}>
            Load more
          </Button>
        </div>
      )}
      <Lightbox
        open={index >= 0}
        index={index}
        close={() => setIndex(-1)}
        slides={slides}
        plugins={[Video, Zoom]}
        on={{ view: ({ index: i }) => setIndex(i) }}
        toolbar={{
          buttons: [
            ...(v.allowDownload && current
              ? [
                  <a key="dl" href={`${API_BASE}/public/shares/${token}/media/${current.id}/download`} className="yarl__button" aria-label="Download" title="Download">
                    <Download className="h-6 w-6" />
                  </a>,
                ]
              : []),
            'close',
          ],
        }}
      />
      <p className="mt-10 text-center text-xs text-muted">Shared privately by Westend City Church. Please do not repost without permission.</p>
    </Shell>
  );
}
