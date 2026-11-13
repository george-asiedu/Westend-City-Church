import { prisma } from './prisma';
import { normalizePhone } from './birthdays';

/** App users for these members: linked accounts first, then matching email/phone. */
export async function usersForMembers(memberIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!memberIds.length) return out;
  const [linked, members, users] = await Promise.all([
    prisma.user.findMany({ where: { memberId: { in: memberIds }, status: 'ACTIVE' }, select: { id: true, memberId: true } }),
    prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, email: true, phone: true } }),
    prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, phone: true } }),
  ]);
  for (const u of linked) out.set(u.memberId!, u.id);
  const byEmail = new Map(users.flatMap((u) => (u.email ? [[u.email.toLowerCase(), u.id] as const] : [])));
  const byPhone = new Map(users.flatMap((u) => (normalizePhone(u.phone) ? [[normalizePhone(u.phone)!, u.id] as const] : [])));
  for (const m of members) {
    if (out.has(m.id)) continue;
    const u = (m.email && byEmail.get(m.email.toLowerCase())) || (normalizePhone(m.phone) && byPhone.get(normalizePhone(m.phone)!));
    if (u) out.set(m.id, u);
  }
  return out;
}

/** Who an announcement goes to (same rules as the API's AudienceService). */
export async function announcementAudience(audience: 'CHURCH' | 'GROUPS' | 'LEADERS', groupIds: string[]): Promise<string[]> {
  if (audience === 'CHURCH') return (await prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id);
  if (audience === 'LEADERS')
    return (await prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD'] } }, select: { id: true } })).map((u) => u.id);
  if (!groupIds.length) return [];
  const [gs, members] = await Promise.all([
    prisma.churchGroup.findMany({ where: { id: { in: groupIds } }, select: { pastorId: true, shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } } }),
    prisma.member.findMany({
      where: { isActive: true, OR: [{ constituencyId: { in: groupIds } }, { basontaId: { in: groupIds } }, { bacentas: { some: { groupId: { in: groupIds } } } }] },
      select: { id: true },
    }),
  ]);
  const leaders = gs.flatMap((g) => [g.pastorId, g.parent?.pastorId, ...g.shepherds.map((s) => s.userId)]).filter((x): x is string => !!x);
  return [...new Set([...leaders, ...(await usersForMembers(members.map((m) => m.id))).values()])];
}
