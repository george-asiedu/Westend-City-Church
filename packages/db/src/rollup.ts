import type { PrismaClient } from '@prisma/client';

export interface BasontaDay {
  id: string;
  name: string;
  pastorId: string | null;
  shepherdIds: string[];
  members: number;
  /** Distinct members present at any of the basonta's sessions that day; null = nothing recorded. */
  present: number | null;
}
export interface ConstituencyDay {
  id: string;
  name: string;
  pastorId: string | null;
  members: number;
  basontas: BasontaDay[];
  /** Sum of its basontas (or its own record when it has no basontas); null = nothing recorded. */
  present: number | null;
  recorded: number;
  missing: number;
}
export interface DayRollup {
  date: string;
  total: number;
  constituencies: ConstituencyDay[];
  services: Array<{ id: string; serviceType: string; title: string | null; present: number; visitors: number }>;
  bacentas: Array<{ id: string; name: string; pastorId: string | null; present: number | null }>;
}

/**
 * Attendance for one day, rolled up the way the church counts it: a constituency's
 * attendance is the sum of its basontas (each basonta counts each member once that day).
 * Shared by the dashboard and the weekend push notifications so they always agree.
 */
export async function dayRollup(prisma: PrismaClient, date: string): Promise<DayRollup> {
  const d = new Date(`${date}T00:00:00.000Z`);
  const [groups, present, services] = await Promise.all([
    prisma.churchGroup.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        parentId: true,
        pastorId: true,
        shepherds: { select: { userId: true } },
        _count: { select: { members: { where: { isActive: true } }, basontaMembers: { where: { isActive: true } } } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<Array<{ groupId: string; n: number }>>`
      SELECT s."groupId", count(DISTINCT r."memberId")::int AS n
      FROM "AttendanceSession" s LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id
      WHERE s."kind" = 'GROUP_MEETING' AND s."date" = ${d}::date
      GROUP BY 1`,
    prisma.attendanceSession.findMany({
      where: { kind: 'CHURCH_SERVICE', date: d },
      select: { id: true, serviceType: true, title: true, visitorCount: true, _count: { select: { records: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const byGroup = new Map(present.map((p) => [p.groupId, p.n]));
  const constituencies: ConstituencyDay[] = groups
    .filter((g) => g.type === 'CONSTITUENCY')
    .map((c) => {
      const basontas = groups
        .filter((b) => b.type === 'BASONTA' && b.parentId === c.id)
        .map((b) => ({
          id: b.id,
          name: b.name,
          pastorId: b.pastorId,
          shepherdIds: b.shepherds.map((s) => s.userId),
          members: b._count.basontaMembers,
          present: byGroup.has(b.id) ? byGroup.get(b.id)! : null,
        }));
      const recorded = basontas.filter((b) => b.present !== null);
      const own = byGroup.has(c.id) ? byGroup.get(c.id)! : null;
      const present = basontas.length ? (recorded.length ? recorded.reduce((a, b) => a + b.present!, 0) : null) : own;
      return {
        id: c.id,
        name: c.name,
        pastorId: c.pastorId,
        members: c._count.members,
        basontas,
        present,
        recorded: basontas.length ? recorded.length : own === null ? 0 : 1,
        missing: basontas.length ? basontas.length - recorded.length : own === null ? 1 : 0,
      };
    });
  return {
    date,
    total: constituencies.reduce((a, c) => a + (c.present ?? 0), 0),
    constituencies,
    services: services.map((s) => ({ id: s.id, serviceType: s.serviceType, title: s.title, present: s._count.records, visitors: s.visitorCount })),
    bacentas: groups.filter((g) => g.type === 'BACENTA').map((b) => ({ id: b.id, name: b.name, pastorId: b.pastorId, present: byGroup.has(b.id) ? byGroup.get(b.id)! : null })),
  };
}
