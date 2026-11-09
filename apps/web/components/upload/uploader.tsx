'use client';

import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import Uppy, { type Meta } from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import AwsS3 from '@uppy/aws-s3';
import GoldenRetriever from '@uppy/golden-retriever';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';
import { DEFAULT_LIMITS, IMAGE_EXTENSIONS, RAW_EXTENSIONS, VIDEO_EXTENSIONS } from '@wcc/shared';
import { api } from '@/lib/api';

interface WccMeta extends Meta {
  mediaId?: string;
  strategy?: 'single' | 'multipart';
  putUrl?: string;
  signedAt?: number;
  uploadId?: string;
  key?: string;
  partSize?: number;
}
type Body = Record<string, unknown>;
type InitResult =
  | { clientId: string; mediaId: string; strategy: 'single'; putUrl: string; headers: Record<string, string> }
  | { clientId: string; mediaId: string; strategy: 'multipart'; uploadId: string; partSize: number; key: string }
  | { clientId: string; error: { code: string; message: string } };

const ALLOWED = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...RAW_EXTENSIONS];

/**
 * Uppy wired to our API (§11.1): the API reserves rows and signs URLs; bytes go
 * straight to S3. Multipart for > 100 MB (16 MB parts, resumable).
 * Golden Retriever keeps the queue in IndexedDB, so a reload, a crash or a
 * dropped connection on a phone resumes instead of starting over (§19 PWA).
 */
export function Uploader({ eventId, onUploaded }: { eventId: string; onUploaded?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const uploading = useRef(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  useEffect(() => {
    // Created inside the effect: React Strict Mode mounts twice in dev, and a
    // destroyed Uppy instance cannot be reused.
    const uppy = new Uppy<WccMeta, Body>({
      id: `wcc-upload-${eventId}`,
      autoProceed: false,
      restrictions: { allowedFileTypes: ALLOWED as unknown as string[], maxFileSize: DEFAULT_LIMITS.maxVideoBytes, maxNumberOfFiles: 1000 },
      onBeforeFileAdded: (file) => {
        // Mirror server limits client-side (§11.3.5).
        const name = (file.name ?? '').toLowerCase();
        const isVideo = VIDEO_EXTENSIONS.some((x) => name.endsWith(x));
        const isRaw = RAW_EXTENSIONS.some((x) => name.endsWith(x));
        const max = isVideo ? DEFAULT_LIMITS.maxVideoBytes : isRaw ? DEFAULT_LIMITS.maxRawBytes : DEFAULT_LIMITS.maxImageBytes;
        return (file.size ?? 0) <= max;
      },
    });

    // Reserve every file with one /uploads/init per 100 files before bytes move.
    const reserve = async (fileIDs: string[]) => {
      const files = fileIDs.map((id) => uppy.getFile(id)).filter((f) => !f.meta.mediaId); // resumed files are already reserved
      for (let i = 0; i < files.length; i += 100) {
        const batch = files.slice(i, i + 100);
        const results = await api<InitResult[]>('/uploads/init', {
          method: 'POST',
          body: { eventId, files: batch.map((f) => ({ clientId: f.id, filename: f.name ?? 'file', size: f.size ?? 0, mimeType: f.type || 'application/octet-stream' })) },
        });
        for (const r of results) {
          if ('error' in r) {
            uppy.info(r.error.message, 'error', 6000);
            uppy.removeFile(r.clientId);
            continue;
          }
          uppy.setFileMeta(r.clientId, {
            mediaId: r.mediaId,
            strategy: r.strategy,
            ...(r.strategy === 'single' ? { putUrl: r.putUrl, signedAt: Date.now() } : { uploadId: r.uploadId, key: r.key, partSize: r.partSize }),
          });
        }
      }
    };
    uppy.addPreProcessor(reserve);

    uppy
      .use(Dashboard, {
        target: el.current!,
        inline: true,
        width: '100%',
        height: 460,
        proudlyDisplayPoweredByUppy: false,
        showProgressDetails: true,
        fileManagerSelectionType: 'both', // files and whole folders
        note: 'Photos up to 60 MB (RAW 120 MB), videos up to 20 GB. Keep this tab open while uploading.',
        theme: 'light', // colours come from the app's tokens (globals.css), which follow the app theme
        locale: {
          strings: {
            dropPasteBoth: 'Drag photos and videos here, %{browseFiles} or %{browseFolders}',
            dropPasteFiles: 'Drag photos and videos here or %{browseFiles}',
            browseFiles: 'choose files',
            browseFolders: 'a whole folder',
          },
        },
      })
      .use(AwsS3, {
        limit: 4,
        shouldUseMultipart: (file) => file.meta.strategy === 'multipart',
        getChunkSize: () => DEFAULT_LIMITS.partSizeBytes,
        async getUploadParameters(file) {
          const m = file.meta as WccMeta;
          if (!m.mediaId) throw new Error('Upload was not reserved');
          // Presigned PUTs live 15 min; long queues re-sign lazily.
          if (!m.putUrl || !m.signedAt || Date.now() - m.signedAt > 10 * 60_000) {
            const fresh = await api<{ url: string; headers: Record<string, string> }>(`/uploads/${m.mediaId}/put-url`, { method: 'POST' });
            uppy.setFileMeta(file.id, { putUrl: fresh.url, signedAt: Date.now() });
            return { method: 'PUT', url: fresh.url, headers: fresh.headers };
          }
          return { method: 'PUT', url: m.putUrl, headers: { 'Content-Type': file.type || 'application/octet-stream' } };
        },
        async createMultipartUpload(file) {
          return { uploadId: String(file.meta.uploadId), key: String(file.meta.key) };
        },
        async signPart(file, { partNumber }) {
          const [part] = await api<Array<{ partNumber: number; url: string }>>(`/uploads/${file.meta.mediaId}/parts`, { method: 'POST', body: { partNumbers: [partNumber] } });
          return { url: part!.url };
        },
        async listParts(file) {
          const parts = await api<Array<{ partNumber: number; etag: string; size: number }>>(`/uploads/${file.meta.mediaId}/parts`);
          return parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag, Size: p.size }));
        },
        async completeMultipartUpload(file, { parts }) {
          await api(`/uploads/${file.meta.mediaId}/complete`, {
            method: 'POST',
            body: { parts: parts.map((p) => ({ partNumber: p.PartNumber!, etag: p.ETag! })) },
          });
          return {};
        },
        async abortMultipartUpload(file) {
          if (file.meta.mediaId) await api(`/uploads/${file.meta.mediaId}`, { method: 'DELETE' }).catch(() => undefined);
        },
      })
      .use(GoldenRetriever, { serviceWorker: false });

    uppy.on('upload-success', (file) => {
      // Single PUTs are verified + queued by /finalize; multipart did it in /complete.
      if (file?.meta.strategy === 'single' && file.meta.mediaId) void api(`/uploads/${file.meta.mediaId}/finalize`, { method: 'POST' }).then(() => onUploadedRef.current?.()).catch((e) => uppy.info(String(e.message ?? e), 'error', 6000));
      else onUploadedRef.current?.();
    });
    uppy.on('file-removed', (file) => {
      // A reserved but unfinished upload is cleaned up right away.
      if (file.meta.mediaId && !file.progress?.uploadComplete) void api(`/uploads/${file.meta.mediaId}`, { method: 'DELETE' }).catch(() => undefined);
    });
    uppy.on('upload', () => (uploading.current = true));
    uppy.on('complete', (result) => {
      uploading.current = false;
      const ok = result.successful?.length ?? 0;
      const bad = result.failed?.length ?? 0;
      if (ok) toast.success(`${ok} file${ok === 1 ? '' : 's'} uploaded. Processing has started.`);
      if (bad) toast.error(`${bad} file${bad === 1 ? '' : 's'} failed to upload. Retry them from the list.`);
    });

    const warn = (e: BeforeUnloadEvent) => {
      if (uploading.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      uppy.destroy();
    };
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps -- onUploaded read via ref

  return <div ref={el} className="wcc-uploader" />;
}
