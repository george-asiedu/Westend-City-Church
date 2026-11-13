import webpush from 'web-push';
import type { PushPayload } from '@wcc/shared';
import { env } from '../env';
import { prisma } from './prisma';
import { log } from './log';

export const pushConfigured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (pushConfigured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

export type PushKind = 'reminder' | 'stats' | 'birthday' | 'announcement' | 'test';

const CONCURRENCY = 20;

/** Runs `fn` over `items` with at most `limit` in flight (a church-wide send can be thousands). */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/**
 * Sends each user their own payload, on every device they have (respecting their
 * preferences). Devices are loaded in one query; sends run 20 at a time; bookkeeping
 * (last success, dead subscriptions removed on 404/410) is written in two batched queries.
 */
export async function pushMessages(messages: Map<string, PushPayload>, kind: PushKind): Promise<{ sent: number; failed: number; removed: number }> {
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!pushConfigured || !env.NOTIFICATIONS_ENABLED || !messages.size) return result;
  const pref = kind === 'reminder' ? { notifyReminders: true } : kind === 'stats' ? { notifyStats: true } : kind === 'birthday' ? { notifyBirthdays: true } : {};
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: [...messages.keys()] }, user: { status: 'ACTIVE', ...pref } } });
  const bodies = new Map([...messages].map(([u, p]) => [u, JSON.stringify(p)]));
  const ok: string[] = [];
  const dead: string[] = [];
  await eachLimited(subs, CONCURRENCY, async (s) => {
    const payload = messages.get(s.userId)!;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, bodies.get(s.userId)!, { TTL: 6 * 3600, urgency: 'normal', topic: payload.tag?.slice(0, 32) });
      ok.push(s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) dead.push(s.id);
      else {
        result.failed++;
        log.warn({ status, endpoint: s.endpoint.slice(0, 60), err: (e as Error).message }, 'push failed');
      }
    }
  });
  result.sent = ok.length;
  result.removed = dead.length;
  await Promise.all([
    ok.length ? prisma.pushSubscription.updateMany({ where: { id: { in: ok } }, data: { lastSuccessAt: new Date() } }) : null,
    dead.length ? prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }) : null,
  ]).catch((e) => log.warn({ err: (e as Error).message }, 'push bookkeeping failed'));
  return result;
}

/** One payload to every device of each user. */
export function pushToUsers(userIds: string[], payload: PushPayload, kind: PushKind): Promise<{ sent: number; failed: number; removed: number }> {
  return pushMessages(new Map([...new Set(userIds)].map((u) => [u, payload])), kind);
}
