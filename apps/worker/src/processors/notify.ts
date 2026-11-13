import type { Job } from 'bullmq';
import { dayRollup } from '@wcc/db';
import { NOTIFY_JOBS, type NotifyTestJob } from '@wcc/shared';
import { env } from '../env';
import { prisma } from '../lib/prisma';
import { log } from '../lib/log';
import { pushToUsers } from '../lib/push';
import { reminderMessages, statsMessages } from '../lib/notify-messages';

/** Today's date (YYYY-MM-DD) in the church's time zone. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function sendAll(messages: Map<string, import('@wcc/shared').PushPayload>, kind: 'reminder' | 'stats') {
  let sent = 0;
  for (const [userId, payload] of messages) sent += (await pushToUsers([userId], payload, kind)).sent;
  return { recipients: messages.size, sent };
}

export async function notify(job: Job): Promise<unknown> {
  switch (job.name) {
    case NOTIFY_JOBS.ATTENDANCE_REMINDER: {
      const date = (job.data as { date?: string })?.date ?? todayIn(env.NOTIFY_TZ);
      const r = await sendAll(reminderMessages(await dayRollup(prisma, date)), 'reminder');
      log.info({ date, ...r }, 'attendance reminders sent');
      return r;
    }
    case NOTIFY_JOBS.WEEKEND_STATS: {
      const date = (job.data as { date?: string })?.date ?? todayIn(env.NOTIFY_TZ);
      const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true } });
      const r = await sendAll(statsMessages(await dayRollup(prisma, date), admins.map((a) => a.id)), 'stats');
      log.info({ date, ...r }, 'weekend stats sent');
      return r;
    }
    case NOTIFY_JOBS.TEST: {
      const { userId } = job.data as NotifyTestJob;
      return pushToUsers([userId], { title: 'Notifications are on', body: 'You’ll get attendance reminders and weekend numbers here.', url: '/account', tag: 'test' }, 'test');
    }
    default:
      throw new Error(`unknown notify job ${job.name}`);
  }
}
