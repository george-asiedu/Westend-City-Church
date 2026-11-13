import type { Job } from 'bullmq';
import { dayRollup } from '@wcc/db';
import { NOTIFY_JOBS, type NotifyTestJob, type RemindGroupsJob } from '@wcc/shared';
import { env } from '../env';
import { prisma } from '../lib/prisma';
import { log } from '../lib/log';
import { pushToUsers } from '../lib/push';
import { dayName, reminderMessages, statsMessages } from '../lib/notify-messages';
import { birthdayMessages, birthdayOn, normalizePhone, type BirthdayPerson } from '../lib/birthdays';

/** Today's date (YYYY-MM-DD) in the church's time zone. */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function sendAll(messages: Map<string, import('@wcc/shared').PushPayload>, kind: 'reminder' | 'stats' | 'birthday') {
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
    case NOTIFY_JOBS.BIRTHDAYS: {
      const date = (job.data as { date?: string })?.date ?? todayIn(env.NOTIFY_TZ);
      const people = await birthdayPeople(date);
      const r = await sendAll(birthdayMessages(people, date), 'birthday');
      log.info({ date, birthdays: people.length, ...r }, 'birthday notifications sent');
      return r;
    }
    case NOTIFY_JOBS.REMIND_GROUPS: {
      const { date, groupIds } = job.data as RemindGroupsJob;
      // Only basontas that still haven't recorded, so a late tap doesn't nag people who just did.
      const r = await dayRollup(prisma, date);
      const wanted = new Set(groupIds);
      const day = dayName(date);
      const msgs = new Map<string, import('@wcc/shared').PushPayload>();
      for (const c of r.constituencies)
        for (const b of c.basontas)
          if (wanted.has(b.id) && b.present === null)
            for (const u of [b.pastorId, ...b.shepherdIds])
              if (u) {
                const prev = msgs.get(u);
                msgs.set(u, {
                  title: `Please record ${day}’s attendance`,
                  body: prev ? `${prev.body}\n${b.name}` : `A Super Admin is asking for ${b.name}’s attendance for ${day}.`,
                  url: '/church/attendance/new',
                  tag: `remind-${date}`,
                });
              }
      const out = await sendAll(msgs, 'reminder');
      log.info({ date, groups: groupIds.length, ...out }, 'requested reminders sent');
      return out;
    }
    case NOTIFY_JOBS.TEST: {
      const { userId } = job.data as NotifyTestJob;
      return pushToUsers([userId], { title: 'Notifications are on', body: 'You’ll get attendance reminders and weekend numbers here.', url: '/account', tag: 'test' }, 'test');
    }
    default:
      throw new Error(`unknown notify job ${job.name}`);
  }
}

/**
 * Members celebrating on `date`, with who to tell: the leaders of their basonta,
 * bacentas and constituency (and the constituency's head pastor), plus app users who are
 * members of those groups (matched to their member record by email or phone).
 */
async function birthdayPeople(date: string): Promise<BirthdayPerson[]> {
  const candidates = await prisma.member.findMany({
    where: { isActive: true, dateOfBirth: { not: null } },
    select: { id: true, fullName: true, email: true, phone: true, dateOfBirth: true, constituencyId: true, basontaId: true, bacentas: { select: { groupId: true } } },
  });
  const today = candidates.filter((c) => birthdayOn(c.dateOfBirth!.toISOString().slice(0, 10), date));
  if (!today.length) return [];
  const groupIdsOf = (x: (typeof today)[number]) => [x.basontaId, x.constituencyId, ...x.bacentas.map((b) => b.groupId)].filter((g): g is string => !!g);
  const allGroupIds = [...new Set(today.flatMap(groupIdsOf))];
  const [groups, groupMembers, users] = await Promise.all([
    prisma.churchGroup.findMany({
      where: { id: { in: allGroupIds }, isActive: true },
      select: { id: true, name: true, pastorId: true, shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } },
    }),
    prisma.member.findMany({
      where: { isActive: true, OR: [{ constituencyId: { in: allGroupIds } }, { basontaId: { in: allGroupIds } }, { bacentas: { some: { groupId: { in: allGroupIds } } } }] },
      select: { id: true, email: true, phone: true, constituencyId: true, basontaId: true, bacentas: { select: { groupId: true } } },
    }),
    prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, phone: true } }),
  ]);
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const byPhone = new Map(users.flatMap((u) => (normalizePhone(u.phone) ? [[normalizePhone(u.phone)!, u.id] as const] : [])));
  const userOf = (x: { email: string | null; phone: string | null }) => (x.email && byEmail.get(x.email.toLowerCase())) || (normalizePhone(x.phone) && byPhone.get(normalizePhone(x.phone)!)) || null;
  const gById = new Map(groups.map((g) => [g.id, g]));
  // App users per group, through their member record.
  const usersIn = new Map<string, Set<string>>();
  for (const gm of groupMembers) {
    const u = userOf(gm);
    if (!u) continue;
    for (const g of [gm.constituencyId, gm.basontaId, ...gm.bacentas.map((b) => b.groupId)]) {
      if (!g || !gById.has(g)) continue;
      if (!usersIn.has(g)) usersIn.set(g, new Set());
      usersIn.get(g)!.add(u);
    }
  }
  return today.map((p) => {
    const gs = groupIdsOf(p).map((g) => gById.get(g)).filter((g): g is NonNullable<typeof g> => !!g);
    const recipients = new Set<string>();
    for (const g of gs) {
      for (const u of [g.pastorId, g.parent?.pastorId, ...g.shepherds.map((s) => s.userId), ...(usersIn.get(g.id) ?? [])]) if (u) recipients.add(u);
    }
    return { id: p.id, fullName: p.fullName, groupNames: gs.map((g) => g.name), recipientIds: [...recipients], selfUserId: userOf(p) };
  });
}
