import type { PrismaClient } from '@prisma/client';
import { normalizePhone } from '@wcc/shared';

/**
 * Who should hear about something in the church. One implementation shared by the API
 * (announcements, follow-ups) and the worker (scheduled announcements, rota reminders,
 * birthdays), so both always reach the same people.
 */

type Db = Pick<PrismaClient, 'user' | 'member' | 'churchGroup'>;

/**
 * Member id → app user id. An account linked to the member record wins; otherwise an active
 * account with the same email or phone number.
 */
export async function usersForMembers(prisma: Db, memberIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!memberIds.length) return out;
  const [linked, members] = await Promise.all([
    prisma.user.findMany({ where: { memberId: { in: memberIds }, status: 'ACTIVE' }, select: { id: true, memberId: true } }),
    prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, email: true, phone: true } }),
  ]);
  for (const u of linked) out.set(u.memberId!, u.id);
  const rest = members.filter((m) => !out.has(m.id));
  if (!rest.length) return out;
  // Only look up the accounts that could match, not every user.
  const emails = [...new Set(rest.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e))];
  const phones = [...new Set(rest.map((m) => normalizePhone(m.phone)).filter((p): p is string => !!p))];
  if (!emails.length && !phones.length) return out;
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', OR: [...(emails.length ? [{ email: { in: emails } }] : []), ...(phones.length ? [{ phone: { in: phones } }] : [])] },
    select: { id: true, email: true, phone: true },
  });
  const byEmail = new Map(users.flatMap((u) => (u.email ? [[u.email.toLowerCase(), u.id] as const] : [])));
  const byPhone = new Map(users.flatMap((u) => (normalizePhone(u.phone) ? [[normalizePhone(u.phone)!, u.id] as const] : [])));
  for (const m of rest) {
    const u = (m.email && byEmail.get(m.email.toLowerCase())) || (normalizePhone(m.phone) && byPhone.get(normalizePhone(m.phone)!));
    if (u) out.set(m.id, u);
  }
  return out;
}

/** Pastors and shepherds of these groups, and the head pastor of their constituency. */
export async function leadersOf(prisma: Db, groupIds: string[]): Promise<string[]> {
  if (!groupIds.length) return [];
  const gs = await prisma.churchGroup.findMany({
    where: { id: { in: groupIds } },
    select: { pastorId: true, shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } },
  });
  return [...new Set(gs.flatMap((g) => [g.pastorId, g.parent?.pastorId, ...g.shepherds.map((s) => s.userId)]).filter((x): x is string => !!x))];
}

/** Everyone for these groups: their leaders plus app users who are members (constituency, basonta or bacenta). */
export async function usersInGroups(prisma: Db, groupIds: string[]): Promise<string[]> {
  if (!groupIds.length) return [];
  const members = await prisma.member.findMany({
    where: { isActive: true, OR: [{ constituencyId: { in: groupIds } }, { basontaId: { in: groupIds } }, { bacentas: { some: { groupId: { in: groupIds } } } }] },
    select: { id: true },
  });
  const [leaders, linked] = await Promise.all([leadersOf(prisma, groupIds), usersForMembers(prisma, members.map((m) => m.id))]);
  return [...new Set([...leaders, ...linked.values()])];
}

/** Every active pastor, shepherd and Super Admin. */
export async function allLeaders(prisma: Db): Promise<string[]> {
  return (await prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD'] } }, select: { id: true } })).map((u) => u.id);
}

/** Every active app user. */
export async function everyone(prisma: Db): Promise<string[]> {
  return (await prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id);
}

/** Who an announcement goes to. */
export function announcementAudience(prisma: Db, audience: 'CHURCH' | 'GROUPS' | 'LEADERS', groupIds: string[]): Promise<string[]> {
  return audience === 'CHURCH' ? everyone(prisma) : audience === 'LEADERS' ? allLeaders(prisma) : usersInGroups(prisma, groupIds);
}

/** Groups a user belongs to: led, shepherded, headed, or as a member (through their linked member record). */
export async function groupsOfUser(prisma: Db, userId: string): Promise<string[]> {
  const [u, led] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { member: { select: { constituencyId: true, basontaId: true, bacentas: { select: { groupId: true } } } } } }),
    prisma.churchGroup.findMany({ where: { OR: [{ pastorId: userId }, { shepherds: { some: { userId } } }, { parent: { pastorId: userId } }] }, select: { id: true } }),
  ]);
  const ids = new Set(led.map((g) => g.id));
  const m = u?.member;
  for (const g of [m?.constituencyId, m?.basontaId, ...(m?.bacentas.map((b) => b.groupId) ?? [])]) if (g) ids.add(g);
  return [...ids];
}
