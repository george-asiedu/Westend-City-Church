import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Ghana numbers in any common form → "0XXXXXXXXX". */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('233') && d.length === 12) d = `0${d.slice(3)}`;
  if (d.length === 9) d = `0${d}`;
  return d.length >= 9 ? d : null;
}

/** A Ghana mobile number as exactly 10 digits (0XXXXXXXXX), or null if it isn't one. */
export function tenDigitPhone(p: string | null | undefined): string | null {
  const n = normalizePhone(p);
  return n && /^0\d{9}$/.test(n) ? n : null;
}

/**
 * Who should hear about something in the church: group leaders, and app users who are
 * members of the group (their account is linked to their member record, or matches its
 * email/phone).
 */
@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Member id → app user id, for these members. */
  async usersForMembers(memberIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!memberIds.length) return out;
    const [linked, members, users] = await Promise.all([
      this.prisma.user.findMany({ where: { memberId: { in: memberIds }, status: 'ACTIVE' }, select: { id: true, memberId: true } }),
      this.prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, email: true, phone: true } }),
      this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, email: true, phone: true } }),
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

  /** Leaders (pastor, shepherds, head pastor) of these groups. */
  async leadersOf(groupIds: string[]): Promise<string[]> {
    if (!groupIds.length) return [];
    const gs = await this.prisma.churchGroup.findMany({
      where: { id: { in: groupIds } },
      select: { pastorId: true, shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } },
    });
    return [...new Set(gs.flatMap((g) => [g.pastorId, g.parent?.pastorId, ...g.shepherds.map((s) => s.userId)]).filter((x): x is string => !!x))];
  }

  /** Everyone for these groups: leaders plus app users who are members (constituency, basonta or bacenta). */
  async usersInGroups(groupIds: string[]): Promise<string[]> {
    if (!groupIds.length) return [];
    const members = await this.prisma.member.findMany({
      where: { isActive: true, OR: [{ constituencyId: { in: groupIds } }, { basontaId: { in: groupIds } }, { bacentas: { some: { groupId: { in: groupIds } } } }] },
      select: { id: true },
    });
    const [leaders, linked] = await Promise.all([this.leadersOf(groupIds), this.usersForMembers(members.map((m) => m.id))]);
    return [...new Set([...leaders, ...linked.values()])];
  }

  /** All leaders in the church (pastors, shepherds, Super Admins). */
  async allLeaders(): Promise<string[]> {
    return (await this.prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD'] } }, select: { id: true } })).map((u) => u.id);
  }

  async everyone(): Promise<string[]> {
    return (await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((u) => u.id);
  }

  /** Groups a user belongs to: led, shepherded, headed, or as a member (through their linked member record). */
  async groupsOfUser(userId: string): Promise<string[]> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { memberId: true, role: true } });
    const led = await this.prisma.churchGroup.findMany({
      where: { OR: [{ pastorId: userId }, { shepherds: { some: { userId } } }, { parent: { pastorId: userId } }] },
      select: { id: true },
    });
    const ids = new Set(led.map((g) => g.id));
    if (u?.memberId) {
      const m = await this.prisma.member.findUnique({ where: { id: u.memberId }, select: { constituencyId: true, basontaId: true, bacentas: { select: { groupId: true } } } });
      for (const g of [m?.constituencyId, m?.basontaId, ...(m?.bacentas.map((b) => b.groupId) ?? [])]) if (g) ids.add(g);
    }
    return [...ids];
  }
}
