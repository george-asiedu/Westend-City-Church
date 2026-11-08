'use client';

import { useEffect, useState } from 'react';
import Lightbox, { type Slide } from 'yet-another-react-lightbox';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Globe, Image as ImageIcon, Info, Star, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatBytes, type MediaDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/form';
import { api, API_BASE, errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/utils';
import { qk, useMe } from '@/lib/queries';

interface MediaDetail extends MediaDto {
  mimeType: string;
  cameraModel: string | null;
  isRaw: boolean;
  isPublicHighlight: boolean;
}

function InfoPanel({ media, eventId, canEditEvent, onClose, onDeleted }: { media: MediaDto; eventId: string; canEditEvent: boolean; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const detail = useQuery({ queryKey: qk.mediaItem(media.id), queryFn: () => api<MediaDetail>(`/media/${media.id}`) });
  const [caption, setCaption] = useState(media.caption ?? '');
  const [tags, setTags] = useState(media.tags.join(', '));
  useEffect(() => {
    setCaption(media.caption ?? '');
    setTags(media.tags.join(', '));
  }, [media]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['media', eventId] });
    void qc.invalidateQueries({ queryKey: qk.mediaItem(media.id) });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/media/${media.id}`, { method: 'PATCH', body }),
    onSuccess: () => (toast.success('Saved'), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = detail.data;

  return (
    <div className="absolute inset-y-0 right-0 z-10 w-full max-w-sm overflow-y-auto bg-[#111]/95 p-5 text-sm text-white sm:border-l sm:border-white/10" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-semibold">Details</p>
        <button onClick={onClose} aria-label="Close details" className="rounded p-1 hover:bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-white/80">
        <dt className="text-white/50">File</dt>
        <dd className="break-all">{media.originalFilename}</dd>
        <dt className="text-white/50">Uploaded by</dt>
        <dd>{media.uploadedBy.fullName}</dd>
        <dt className="text-white/50">Taken</dt>
        <dd>{formatDateTime(media.takenAt)}</dd>
        {d?.cameraModel && (
          <>
            <dt className="text-white/50">Camera</dt>
            <dd>{d.cameraModel}</dd>
          </>
        )}
        <dt className="text-white/50">Size</dt>
        <dd>
          {media.width && media.height ? `${media.width} × ${media.height} · ` : ''}
          {formatBytes(media.sizeBytes)}
          {media.durationSec ? ` · ${formatDuration(media.durationSec)}` : ''}
          {d?.isRaw ? ' · RAW' : ''}
        </dd>
      </dl>

      {media.canEdit ? (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-white/60">Caption</span>
            <Textarea className="border-white/20 bg-white/5 text-white" value={caption} maxLength={1000} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-white/60">Tags (comma separated)</span>
            <Input className="border-white/20 bg-white/5 text-white" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Bishop, Choir, Ushers" />
          </label>
          <Button
            size="sm"
            loading={patch.isPending}
            onClick={() => patch.mutate({ caption: caption || null, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })}
          >
            Save details
          </Button>
        </div>
      ) : (
        <>
          {media.caption && <p className="mb-3">{media.caption}</p>}
          {media.tags.length > 0 && <p className="text-white/70">{media.tags.map((t) => `#${t}`).join(' ')}</p>}
        </>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <a href={`${API_BASE}/media/${media.id}/download`}>
          <Button size="sm" variant="secondary">
            <Download className="h-4 w-4" /> Original
          </Button>
        </a>
        {media.canEdit && (
          <Button size="sm" variant="secondary" onClick={() => patch.mutate({ isFeatured: !media.isFeatured })}>
            <Star className="h-4 w-4" /> {media.isFeatured ? 'Unfeature' : 'Feature'}
          </Button>
        )}
        {canEditEvent && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              api(`/events/${eventId}/cover`, { method: 'POST', body: { mediaId: media.id } })
                .then(() => (toast.success('Cover updated'), qc.invalidateQueries({ queryKey: qk.event(eventId) })))
                .catch((e) => toast.error(errorMessage(e)))
            }
          >
            <ImageIcon className="h-4 w-4" /> Set as cover
          </Button>
        )}
        {me.data?.permissions.isAdmin && d && (
          <Button size="sm" variant="secondary" onClick={() => patch.mutate({ isPublicHighlight: !d.isPublicHighlight })}>
            <Globe className="h-4 w-4" /> {d.isPublicHighlight ? 'Remove from highlights' : 'Public highlight'}
          </Button>
        )}
        {media.canDelete && (
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              api(`/media/${media.id}`, { method: 'DELETE' })
                .then(() => (toast.success('Moved to Trash'), onDeleted()))
                .catch((e) => toast.error(errorMessage(e)))
            }
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        )}
      </div>
      <p className="mt-6 text-xs text-white/40">Original files may contain location data. Previews here have it removed.</p>
    </div>
  );
}

export function MediaLightbox({
  items,
  index,
  onIndex,
  onClose,
  eventId,
  canEditEvent,
  onDeleted,
}: {
  items: MediaDto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  eventId: string;
  canEditEvent: boolean;
  onDeleted: () => void;
}) {
  const [info, setInfo] = useState(false);
  const slides: Slide[] = items.map((m) =>
    m.type === 'VIDEO'
      ? { type: 'video', poster: m.posterUrl ?? undefined, width: m.width ?? 1280, height: m.height ?? 720, sources: m.playbackUrl ? [{ src: m.playbackUrl, type: 'video/mp4' }] : [] }
      : { src: m.previewUrl ?? m.thumbUrl ?? '', alt: m.caption || 'Photo', width: m.width ?? undefined, height: m.height ?? undefined },
  );
  const current = items[index];

  return (
    <Lightbox
      open={index >= 0}
      index={index}
      close={onClose}
      slides={slides}
      plugins={[Video, Zoom]}
      on={{ view: ({ index: i }) => onIndex(i) }}
      carousel={{ finite: false, preload: 2 }}
      controller={{ closeOnBackdropClick: false }}
      video={{ controls: true, playsInline: true, preload: 'metadata' }}
      toolbar={{
        buttons: [
          <a key="dl" href={current ? `${API_BASE}/media/${current.id}/download` : undefined} className="yarl__button" aria-label="Download original" title="Download original">
            <Download className="h-6 w-6" />
          </a>,
          <button key="info" type="button" className="yarl__button" aria-label="Details" title="Details" onClick={() => setInfo((v) => !v)}>
            <Info className="h-6 w-6" />
          </button>,
          'close',
        ],
      }}
      render={{
        controls: () =>
          info && current ? (
            <InfoPanel media={current} eventId={eventId} canEditEvent={canEditEvent} onClose={() => setInfo(false)} onDeleted={() => (setInfo(false), onDeleted())} />
          ) : null,
      }}
    />
  );
}
