import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { keys, VARIANT_FILES, GB, type ProcessMediaJob } from '@wcc/shared';
import { env } from '../env';
import { claim, markReady, rejectContent, type VariantOut } from '../lib/media';
import { head, putBuffer, putFile, signedGet } from '../lib/s3';
import { sniff } from '../lib/sniff';
import { ffprobe, hasRoomFor, HTTP_INPUT, run } from '../lib/proc';
import { prisma } from '../lib/prisma';
import { log } from '../lib/log';

export async function processVideo(job: Job<ProcessMediaJob>, token?: string): Promise<void> {
  const m = await claim(job.data.mediaId);
  if (!m) return;
  const started = Date.now();

  const detected = sniff(await head(m.originalKey));
  if (!detected || detected.kind !== 'VIDEO') {
    await rejectContent(m, `File content does not match an allowed video type (${detected?.mime ?? 'unknown'})`);
    throw new UnrecoverableError('content rejected');
  }

  // Read straight from S3 over HTTPS; nothing of the original touches the disk.
  const input = await signedGet(m.originalKey);
  const probe = await ffprobe(input);
  if (!probe.videoCodec) {
    await rejectContent(m, 'No video stream found');
    throw new UnrecoverableError('no video stream');
  }

  const workDir = join(env.WORKER_TMP_DIR, m.id);
  await mkdir(workDir, { recursive: true });
  try {
    const variants: VariantOut[] = [];
    const threads = String(env.FFMPEG_THREADS);

    // POSTER: a frame at min(3 s, 10% of duration), 1280px long edge.
    const at = Math.min(3, (probe.durationSec ?? 0) * 0.1);
    const posterFile = join(workDir, 'poster.jpg');
    await run('ffmpeg', ['-v', 'error', ...HTTP_INPUT, '-ss', at.toFixed(2), '-i', input, '-frames:v', '1', '-threads', threads, '-q:v', '3', '-y', posterFile], { timeoutMs: 10 * 60_000 });
    const poster = await sharp(posterFile).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    const posterKey = keys.variant(m.originalKey, VARIANT_FILES.POSTER);
    variants.push({ kind: 'POSTER', key: posterKey, mimeType: 'image/jpeg', width: poster.info.width, height: poster.info.height, sizeBytes: await putBuffer(posterKey, poster.data, 'image/jpeg') });
    const thumb = await sharp(poster.data).resize(400, 400, { fit: 'inside' }).webp({ quality: 72 }).toBuffer({ resolveWithObject: true });
    const thumbKey = keys.variant(m.originalKey, VARIANT_FILES.THUMB);
    variants.push({ kind: 'THUMB', key: thumbKey, mimeType: 'image/webp', width: thumb.info.width, height: thumb.info.height, sizeBytes: await putBuffer(thumbKey, thumb.data, 'image/webp') });

    // VIDEO_PREVIEW only when the original is not already browser-friendly (§8.3 step 3).
    const browserFriendly =
      probe.videoCodec === 'h264' &&
      (!probe.audioCodec || probe.audioCodec === 'aac') &&
      /mp4|mov/.test(probe.formatName) &&
      Math.max(probe.width ?? 0, probe.height ?? 0) <= 1920 &&
      Number(m.sizeBytes) <= 2 * GB;
    const tooLong = (probe.durationSec ?? 0) > env.VIDEO_TRANSCODE_MAX_DURATION_SEC;
    if (env.VIDEO_TRANSCODE_ENABLED && !browserFriendly && !tooLong) {
      // ~3 Mbit/s at 720p plus headroom; wait (not fail) if the shared disk is tight.
      const estimate = ((probe.durationSec ?? 3600) * 3_000_000) / 8 + 512 * 1024 ** 2;
      if (!(await hasRoomFor(estimate))) {
        log.warn({ mediaId: m.id, estimate }, 'tmp disk low; delaying transcode 10 min');
        await prisma.mediaAsset.update({ where: { id: m.id }, data: { status: 'UPLOADED' } });
        await job.moveToDelayed(Date.now() + 10 * 60_000, token);
        throw new DelayedError();
      }
      const out = join(workDir, 'preview-720p.mp4');
      await run(
        'ffmpeg',
        ['-v', 'error', ...HTTP_INPUT, '-i', input, '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-threads', threads, '-y', out],
        { timeoutMs: Math.max(30 * 60_000, (probe.durationSec ?? 0) * 3000) },
      );
      const key = keys.variant(m.originalKey, VARIANT_FILES.VIDEO_PREVIEW);
      const { size } = await stat(out);
      if (size > 0) {
        const h = 720;
        const w = probe.width && probe.height ? Math.round((probe.width / probe.height) * h / 2) * 2 : null;
        variants.push({ kind: 'VIDEO_PREVIEW', key, mimeType: 'video/mp4', width: w, height: h, sizeBytes: await putFile(key, out, 'video/mp4') });
      }
    }

    await markReady(
      m.id,
      m.eventId,
      { detectedMime: detected.mime, width: probe.width, height: probe.height, durationSec: probe.durationSec ?? undefined, takenAt: probe.creationTime },
      variants,
    );
    log.info({ jobId: job.id, mediaId: m.id, ms: Date.now() - started, transcoded: variants.some((v) => v.kind === 'VIDEO_PREVIEW') }, 'video ready');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
