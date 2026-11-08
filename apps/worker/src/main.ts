import { Worker, type Job } from 'bullmq';
import { mkdir } from 'node:fs/promises';
import { exiftool } from 'exiftool-vendored';
import { MAINTENANCE_JOBS, QUEUES } from '@wcc/shared';
import { env } from './env';
import { connection, queues } from './queues';
import { log } from './lib/log';
import { prisma } from './lib/prisma';
import { markFailed } from './lib/media';
import { processImage } from './processors/image';
import { processVideo } from './processors/video';
import { purgeMedia } from './processors/purge';
import { maintenance } from './processors/maintenance';
import { sendMail } from './processors/mail';
import { buildExport } from './processors/export';

/** Retries: 30 s, 2 min, 10 min (§8.3). */
const backoffStrategy = (attemptsMade: number) => [30_000, 120_000, 600_000][attemptsMade - 1] ?? 600_000;

function worker<T>(name: string, concurrency: number, fn: (job: Job<T>, token?: string) => Promise<unknown>, extra: Partial<ConstructorParameters<typeof Worker>[2]> = {}) {
  const w = new Worker<T>(name, fn, { connection, prefix: env.QUEUE_PREFIX, concurrency, settings: { backoffStrategy }, ...extra });
  w.on('failed', (job, err) => log.error({ queue: name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed'));
  w.on('error', (err) => log.error({ queue: name, err: err.message }, 'worker error'));
  return w;
}

/** On the last failed attempt, mark the media FAILED so admins see "Retry processing". */
function failMediaOnFinalAttempt(w: Worker<{ mediaId: string }>) {
  w.on('failed', async (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err.name === 'UnrecoverableError';
    if (final && err.message !== 'content rejected') await markFailed(job.data.mediaId, err.message).catch(() => undefined);
  });
}

async function scheduleMaintenance(): Promise<void> {
  const tz = 'Africa/Accra';
  const plan: Array<[string, string]> = [
    [MAINTENANCE_JOBS.PURGE_TRASH, '0 2 * * *'],
    [MAINTENANCE_JOBS.ABORT_STALE_UPLOADS, '15 * * * *'],
    [MAINTENANCE_JOBS.RECONCILE_COUNTERS, '0 3 * * *'],
    [MAINTENANCE_JOBS.PRUNE_SESSIONS, '0 4 * * *'],
    [MAINTENANCE_JOBS.PURGE_EXPORTS, '30 * * * *'],
    [MAINTENANCE_JOBS.PRUNE_AUDIT, '0 5 1 * *'],
  ];
  for (const [name, pattern] of plan)
    await queues.maintenance.upsertJobScheduler(name, { pattern, tz }, { name, opts: { removeOnComplete: 50, removeOnFail: 200 } });
}

async function main(): Promise<void> {
  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  await scheduleMaintenance();

  const image = worker(QUEUES.IMAGE, env.IMAGE_CONCURRENCY, processImage);
  // Long transcodes: generous lock so a busy CPU does not make BullMQ think the job stalled.
  const video = worker(QUEUES.VIDEO, env.VIDEO_CONCURRENCY, processVideo, { lockDuration: 10 * 60_000 });
  failMediaOnFinalAttempt(image);
  failMediaOnFinalAttempt(video);
  const workers = [
    image,
    video,
    worker(QUEUES.DELETE, 4, purgeMedia),
    worker(QUEUES.MAINTENANCE, 1, maintenance),
    worker(QUEUES.MAIL, 2, sendMail),
    worker(QUEUES.EXPORT, 1, buildExport, { lockDuration: 10 * 60_000 }),
  ];
  log.info({ queues: Object.values(QUEUES), tmp: env.WORKER_TMP_DIR }, 'worker started');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down; letting running jobs finish');
    await Promise.allSettled(workers.map((w) => w.close()));
    await Promise.allSettled(Object.values(queues).map((q) => q.close()));
    await exiftool.end();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  log.fatal(e);
  process.exit(1);
});
