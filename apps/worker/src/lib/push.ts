import webpush from 'web-push';
import type { PushPayload } from '@wcc/shared';
import { env } from '../env';
import { prisma } from './prisma';
import { log } from './log';

export const pushConfigured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushConfigured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

export type PushKind = 'reminder' | 'stats' | 'birthday' | 'test';

/**
 * Sends one payload to every device of each user (respecting their preferences).
 * Dead subscriptions (404/410 from the push service) are deleted.
 */
export async function pushToUsers(userIds: string[], payload: PushPayload, kind: PushKind): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!pushConfigured || !env.NOTIFICATIONS_ENABLED || !userIds.length) return result;
  const subs = await prisma.pushSubscription.findMany({
    where: {
      userId: { in: [...new Set(userIds)] },
      user: { status: 'ACTIVE', ...(kind === 'reminder' ? { notifyReminders: true } : kind === 'stats' ? { notifyStats: true } : kind === 'birthday' ? { notifyBirthdays: true } : {}) },
    },
  });
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 6 * 3600, urgency: 'normal', topic: payload.tag?.slice(0, 32) });
        result.sent++;
        await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          result.removed++;
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        } else {
          result.failed++;
          log.warn({ status, endpoint: s.endpoint.slice(0, 60), err: (e as Error).message }, 'push failed');
        }
      }
    }),
  );
  return result;
}
