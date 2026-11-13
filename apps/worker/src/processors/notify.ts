import type { Job } from 'bullmq';
import { dayRollup } from '@wcc/db';
import { NOTIFY_JOBS, type NotifyTestJob, type PushJob, type RemindGroupsJob } from '@wcc/shared';
import { env } from '../env';
import { prisma } from '../lib/prisma';
import { log } from '../lib/log';
import { pushToUsers } from '../lib/push';
import { dayName, reminderMessages, statsMessages } from '../lib/notify-messages';
import { queues } from '../queues';
import { announcementAudience, usersForMembers } from '../lib/audience';
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
                  title: `Could you record ${day}’s attendance?`,
                  body: prev ? `${prev.body}\n${b.name}` : `The church office is still waiting for ${b.name}’s numbers for ${day}. Thank you!`,
                  url: '/church/attendance/new',
                  tag: `remind-${date}`,
                });
              }
      const out = await sendAll(msgs, 'reminder');
      log.info({ date, groups: groupIds.length, ...out }, 'requested reminders sent');
      return out;
    }
    case NOTIFY_JOBS.PUSH: {
      const { userIds, payload, kind } = job.data as PushJob;
      return pushToUsers(userIds, payload, kind);
    }
    case NOTIFY_JOBS.ANNOUNCEMENTS_DUE:
      return announcementsDue();
    case NOTIFY_JOBS.ROSTER_REMINDERS:
      return rosterReminders((job.data as { date?: string })?.date);
    case NOTIFY_JOBS.MONTHLY_REPORT:
      return monthlyReport((job.data as { month?: string })?.month);
    case NOTIFY_JOBS.TEST: {
      const { userId } = job.data as NotifyTestJob;
      return pushToUsers([userId], { title: 'You’re all set', body: 'Notifications are working. We’ll let you know about reminders, birthdays and church news here.', url: '/account', tag: 'test' }, 'test');
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
    prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, phone: true, memberId: true } }),
  ]);
  const byMember = new Map(users.flatMap((u) => (u.memberId ? [[u.memberId, u.id] as const] : [])));
  const byEmail = new Map(users.flatMap((u) => (u.email ? [[u.email.toLowerCase(), u.id] as const] : [])));
  const byPhone = new Map(users.flatMap((u) => (normalizePhone(u.phone) ? [[normalizePhone(u.phone)!, u.id] as const] : [])));
  const userOf = (x: { id: string; email: string | null; phone: string | null }) => byMember.get(x.id) || (x.email && byEmail.get(x.email.toLowerCase())) || (normalizePhone(x.phone) && byPhone.get(normalizePhone(x.phone)!)) || null;
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

/** Scheduled announcements whose time has come: push each once. */
async function announcementsDue() {
  const due = await prisma.announcement.findMany({ where: { notifiedAt: null, publishAt: { lte: new Date() } }, include: { groups: true }, take: 20 });
  let sent = 0;
  for (const a of due) {
    const claimed = await prisma.announcement.updateMany({ where: { id: a.id, notifiedAt: null }, data: { notifiedAt: new Date() } });
    if (!claimed.count) continue;
    if (a.expiresAt && a.expiresAt <= new Date()) continue;
    const userIds = await announcementAudience(a.audience, a.groups.map((g) => g.groupId));
    const body = a.body.length > 160 ? `${a.body.slice(0, 157)}…` : a.body;
    sent += (await pushToUsers(userIds, { title: a.title, body, url: '/announcements', tag: `ann-${a.id}`.slice(0, 32) }, 'announcement')).sent;
  }
  if (due.length) log.info({ announcements: due.length, sent }, 'scheduled announcements sent');
  return { announcements: due.length, sent };
}

/** The evening before: remind people on tomorrow's bacenta rota. */
async function rosterReminders(date?: string) {
  const today = date ?? todayIn(env.NOTIFY_TZ);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000);
  const slots = await prisma.rosterSlot.findMany({
    where: { date: tomorrow },
    include: { group: { select: { name: true } }, role: { select: { name: true } }, member: { select: { id: true, fullName: true } } },
  });
  if (!slots.length) return { slots: 0, recipients: 0, sent: 0 };
  const users = await usersForMembers([...new Set(slots.map((s) => s.member.id))]);
  const msgs = new Map<string, import('@wcc/shared').PushPayload>();
  for (const s of slots) {
    const u = users.get(s.member.id);
    if (!u) continue;
    const what = [s.role?.name, s.service].filter(Boolean).join(', ') || 'on duty';
    const line = `${s.group.name}: ${what}`;
    const prev = msgs.get(u);
    msgs.set(u, { title: 'You’re serving tomorrow', body: prev ? `${prev.body}\n${line}` : `${line}\nThank you for serving!`, url: '/me/church', tag: `rota-${today}` });
  }
  const r = await sendAll(msgs, 'reminder');
  log.info({ date: today, slots: slots.length, ...r }, 'rota reminders sent');
  return { slots: slots.length, ...r };
}

/** Last month in numbers, emailed and pushed to Super Admins. `month` = YYYY-MM (default: last month). */
export async function monthlyReport(month?: string) {
  const now = todayIn(env.NOTIFY_TZ);
  const [y, m] = (month ?? '').match(/^\d{4}-\d{2}$/) ? month!.split('-').map(Number) : [Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1];
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  const label = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const inMonth = { gte: start, lt: end };
  const [meetings, services, newMembers, guests, cards, followUpsDone, followUpsOpen, active] = await Promise.all([
    prisma.attendanceSession.findMany({ where: { date: inMonth, kind: 'GROUP_MEETING' }, select: { _count: { select: { records: true } } } }),
    prisma.attendanceSession.findMany({ where: { date: inMonth, kind: 'CHURCH_SERVICE' }, select: { headcount: true, date: true } }),
    prisma.member.count({ where: { createdAt: inMonth } }),
    prisma.guest.count({ where: { createdAt: inMonth, sessionId: { not: null } } }),
    prisma.guest.count({ where: { createdAt: inMonth, sessionId: null } }),
    prisma.followUp.count({ where: { closedAt: inMonth } }),
    prisma.followUp.count({ where: { status: { not: 'DONE' } } }),
    prisma.member.count({ where: { isActive: true } }),
  ]);
  const present = meetings.reduce((a, s) => a + s._count.records, 0);
  const serviceTotal = services.reduce((a, s) => a + (s.headcount ?? 0), 0);
  const sundays = new Set(services.map((s) => s.date.toISOString().slice(0, 10))).size;
  const lines = [
    `Here’s a look back at ${label} at Westend City Church.`,
    `Church services: ${services.length} recorded, with ${serviceTotal} people in total${sundays ? ` (about ${Math.round(serviceTotal / sundays)} each service day)` : ''}.`,
    `Group meetings: ${meetings.length} held, with ${present} member attendances${meetings.length ? ` (about ${Math.round(present / meetings.length)} at each)` : ''}.`,
    `We welcomed ${newMembers} new member${newMembers === 1 ? '' : 's'}, and ${active} members are active now.`,
    `New faces: ${guests} brought by members and ${cards} welcome card${cards === 1 ? '' : 's'} filled in.`,
    `Follow-ups: ${followUpsDone} done and ${followUpsOpen} still waiting for a call or visit.`,
    'Thank you for all you do.',
  ];

  const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true, email: true, fullName: true } });
  for (const a of admins.filter((x) => x.email))
    await queues.mail.add(
      'send',
      { to: a.email, template: 'monthly-report', data: { name: a.fullName.split(' ')[0] ?? '', month: label, lines: lines.join('\n'), link: `${env.WEB_ORIGIN}/church/attendance` } },
      { attempts: 3, removeOnComplete: 500 },
    );
  await pushToUsers(admins.map((a) => a.id), { title: `How ${label} went`, body: `${lines[1]} ${lines[3]}`, url: '/church/attendance', tag: 'monthly' }, 'stats');
  log.info({ month: label, admins: admins.length }, 'monthly report sent');
  return { month: label, admins: admins.length, lines };
}
