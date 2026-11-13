import { Worker, type Job } from 'bullmq';
import { mkdir } from 'node:fs/promises';
import { exiftool } from 'exiftool-vendored';
import { notify } from './processors/notify';
import { pushConfigured } from './lib/push';
import { MAINTENANCE_JOBS, NOTIFY_JOBS, QUEUES } from '@wcc/shared';
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

/** Weekly push: reminders to record attendance, then the day's numbers. */
async function scheduleNotifications(): Promise<void> {
  const plan: Array<[string, string, string]> = [
    ['reminder-saturday', NOTIFY_JOBS.ATTENDANCE_REMINDER, env.REMINDER_CRON_SATURDAY],
    ['reminder-sunday', NOTIFY_JOBS.ATTENDANCE_REMINDER, env.REMINDER_CRON_SUNDAY],
    ['stats-saturday', NOTIFY_JOBS.WEEKEND_STATS, env.STATS_CRON_SATURDAY],
    ['stats-sunday', NOTIFY_JOBS.WEEKEND_STATS, env.STATS_CRON_SUNDAY],
    ['birthdays-daily', NOTIFY_JOBS.BIRTHDAYS, env.BIRTHDAY_CRON],
    ['announcements-due', NOTIFY_JOBS.ANNOUNCEMENTS_DUE, env.ANNOUNCEMENTS_CRON],
    ['roster-reminders', NOTIFY_JOBS.ROSTER_REMINDERS, env.ROSTER_CRON],
  ];
  for (const [id, name, pattern] of plan) {
    if (env.NOTIFICATIONS_ENABLED && pushConfigured)
      await queues.notify.upsertJobScheduler(id, { pattern, tz: env.NOTIFY_TZ }, { name, opts: { removeOnComplete: 50, removeOnFail: 200 } });
    else await queues.notify.removeJobScheduler(id);
  }
  // The monthly report is emailed, so it runs even without push.
  await queues.notify.upsertJobScheduler('monthly-report', { pattern: env.MONTHLY_REPORT_CRON, tz: env.NOTIFY_TZ }, { name: NOTIFY_JOBS.MONTHLY_REPORT, opts: { removeOnComplete: 50, removeOnFail: 200 } });
  if (!pushConfigured) log.warn('push notifications off: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY');
}

async function main(): Promise<void> {
  await mkdir(env.WORKER_TMP_DIR, { recursive: true });
  await scheduleMaintenance();
  await scheduleNotifications();

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
    worker(QUEUES.NOTIFY, 1, notify),
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
