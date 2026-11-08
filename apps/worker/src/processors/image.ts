import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { exiftool } from 'exiftool-vendored';
import { UnrecoverableError, type Job } from 'bullmq';
import { keys, VARIANT_FILES, type ProcessMediaJob } from '@wcc/shared';
import { env } from '../env';
import { claim, markReady, rejectContent, type VariantOut } from '../lib/media';
import { download, head, putBuffer } from '../lib/s3';
import { sniff } from '../lib/sniff';
import { run } from '../lib/proc';
import { log } from '../lib/log';

sharp.cache(false); // shared VPS: no long-lived pixel cache
sharp.concurrency(1);

const RAW_TIFF_EXT = /\.(nef|arw|dng|cr2)$/i;

function exifDate(v: unknown): Date | null {
  if (!v) return null;
  const s = typeof v === 'string' ? v : typeof (v as { toISOString?: () => string }).toISOString === 'function' ? (v as { toISOString: () => string }).toISOString() : String(v);
  const iso = s.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`); // no offset: treat as Accra (UTC+0)
  return Number.isNaN(d.getTime()) || d.getFullYear() < 1990 ? null : d;
}

/** HEIC from phones: prebuilt sharp lacks HEVC, so fall back to heif-convert (§8.3 step 4). */
async function openImage(file: string, mime: string, workDir: string): Promise<string> {
  if (mime !== 'image/heic' && mime !== 'image/heif') return file;
  try {
    await sharp(file).metadata().then((m) => {
      if (!m.width) throw new Error('no dimensions');
    });
    await sharp(file).resize(8).toBuffer();
    return file;
  } catch {
    const out = join(workDir, 'decoded.jpg');
    await run('heif-convert', ['-q', '92', file, out], { timeoutMs: 120_000 });
    return out;
  }
}

export async function processImage(job: Job<ProcessMediaJob>): Promise<void> {
  const m = await claim(job.data.mediaId);
  if (!m) return; // deleted, or already processed
  const started = Date.now();

  const detected = sniff(await head(m.originalKey));
  const looksRaw = m.isRaw && (detected?.kind === 'RAW' || (detected?.mime === 'image/tiff' && RAW_TIFF_EXT.test(m.originalFilename)));
  if (!detected || (detected.kind !== 'IMAGE' && !looksRaw) || (detected.mime === 'image/tiff' && m.isRaw && !looksRaw)) {
    await rejectContent(m, `File content does not match an allowed image type (${detected?.mime ?? 'unknown'})`);
    throw new UnrecoverableError('content rejected');
  }

  const workDir = join(env.WORKER_TMP_DIR, m.id);
  await mkdir(workDir, { recursive: true });
  try {
    const original = join(workDir, 'original');
    await download(m.originalKey, original);
    const tags = await exiftool.read(original).catch(() => null);

    // RAW: render variants from the embedded JPEG preview (§19).
    let source = original;
    if (looksRaw) {
      source = join(workDir, 'embedded.jpg');
      await exiftool.extractPreview(original, source).catch(() => exiftool.extractJpgFromRaw(original, source));
      if (!(await stat(source).catch(() => null))) throw new UnrecoverableError('RAW file has no embedded preview');
    } else {
      source = await openImage(original, detected.mime, workDir);
    }

    const base = sharp(source, { failOn: 'error', limitInputPixels: 300_000_000 }).rotate(); // auto-orient; metadata is stripped by default
    const meta = await sharp(source).rotate().metadata();
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? null;
    const height = (swap ? meta.width : meta.height) ?? null;

    const variants: VariantOut[] = [];
    for (const [kind, size, quality, file] of [
      ['THUMB', 400, 72, VARIANT_FILES.THUMB],
      ['PREVIEW', 1600, 80, VARIANT_FILES.PREVIEW],
    ] as const) {
      const { data, info } = await base.clone().resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer({ resolveWithObject: true });
      const key = keys.variant(m.originalKey, file);
      variants.push({ kind, key, mimeType: 'image/webp', width: info.width, height: info.height, sizeBytes: await putBuffer(key, data, 'image/webp') });
    }

    await markReady(
      m.id,
      m.eventId,
      {
        detectedMime: detected.mime,
        width,
        height,
        takenAt: exifDate(tags?.DateTimeOriginal ?? tags?.CreateDate),
        cameraModel: tags?.Model ? String(tags.Model).slice(0, 120) : null,
      },
      variants,
    );
    log.info({ jobId: job.id, mediaId: m.id, ms: Date.now() - started }, 'image ready');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
