import { Injectable } from '@nestjs/common';
import { Prisma, dayRollup, type AttendanceKind, type GuestIntent } from '@wcc/db';
import { SUNDAY_SERVICE_TITLES, isPerServiceType } from '@wcc/shared';
import type {
  AttendanceSheetDto,
  AttendanceSummaryDto,
  GuestDto,
  Page,
  SessionInfoDto,
  SessionRowDto,
} from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, fromDateOnly, pageOf, pageSize, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import {
  activeCounts,
  groupInclude,
  ref,
  countFor,
  memberWhereFor,
  SessionInput,
  SheetInput,
  BroughtInput,
  NIL_UUID,
  blank,
  conflict,
  isUnique,
  range,
  MembershipCore,
} from './core';

/** Attendance sheets, church-service head-counts, guests and summaries. */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly core: MembershipCore,
  ) {}

  private async sessionContext(user: AuthUser, id: string) {
    const s = await this.prisma.attendanceSession.findUnique({
      where: { id },
      include: {
        group: {
          include: { shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } },
        },
        recordedBy: { select: { fullName: true } },
      },
    });
    if (!s) throw notFound('Attendance');
    const canEdit = s.group
      ? this.policy.canManageGroup(user, ref(s.group))
      : this.policy.canRecordSunday(user);
    const where: Prisma.MemberWhereInput = s.group ? memberWhereFor(s.group) : {};
    return { s, canEdit, where };
  }

  private sessionInfo(s: Awaited<ReturnType<AttendanceService['sessionContext']>>['s']): SessionInfoDto {
    return {
      id: s.id,
      kind: s.kind,
      serviceType: s.serviceType,
      title: s.title,
      date: fromDateOnly(s.date)!,
      group: s.group ? { id: s.group.id, name: s.group.name, type: s.group.type } : null,
      visitorCount: s.visitorCount,
      firstTimerCount: s.firstTimerCount,
      headcount: s.kind === 'CHURCH_SERVICE' ? (s.headcount ?? 0) : null,
      newConvertCount: s.newConvertCount,
      notes: s.notes,
      recordedBy: s.recordedBy?.fullName ?? null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  /** Creates (or opens the existing) session for a service/meeting on a date. */
  async createSession(
    user: AuthUser,
    dto: SessionInput,
    meta: ReqMeta,
  ): Promise<{ id: string; created: boolean }> {
    this.core.checkDate(dto.date);
    const serviceType = dto.serviceType.trim();
    if (!serviceType) throw badRequest('INVALID', 'Say what kind of service or meeting this is');
    let group: Awaited<ReturnType<MembershipCore['loadGroup']>> | null = null;
    if (dto.groupId) {
      group = await this.core.loadGroup(dto.groupId);
      // Members are recorded once, in their basonta; a constituency is the total of its basontas.
      if (group.type === 'CONSTITUENCY')
        throw badRequest(
          'CONSTITUENCY_TOTAL',
          'A constituency’s attendance is the total of its basontas. Record attendance in each basonta instead.',
        );
      if (!this.policy.canManageGroup(user, ref(group)))
        throw forbidden('Only this group’s leaders or a Super Admin can take its attendance');
    } else if (!this.policy.canRecordSunday(user))
      throw forbidden(
        'Church services are recorded by the ushers (the service-recording bacenta) or a Super Admin',
      );
    const title = blank(dto.title) ?? null;
    if (!group && isPerServiceType(serviceType) && !SUNDAY_SERVICE_TITLES.some((t) => t === title)) {
      throw badRequest('SERVICE_TITLE', `Choose which service: ${SUNDAY_SERVICE_TITLES.join(' or ')}`);
    }
    const date = toDateOnly(dto.date);
    const kind: AttendanceKind = group ? 'GROUP_MEETING' : 'CHURCH_SERVICE';
    const existing = await this.prisma.attendanceSession.findFirst({
      where: {
        kind,
        groupId: group?.id ?? null,
        date,
        serviceType: { equals: serviceType, mode: 'insensitive' },
        title: title ? { equals: title, mode: 'insensitive' } : null,
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    try {
      const s = await this.prisma.attendanceSession.create({
        data: {
          kind,
          groupId: group?.id ?? null,
          date,
          serviceType,
          title,
          recordedById: user.id,
          headcount: kind === 'CHURCH_SERVICE' ? 0 : null,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'ATTENDANCE_CREATED',
        entityType: 'ATTENDANCE',
        entityId: s.id,
        metadata: { serviceType, title, date: dto.date, group: group?.name ?? null },
        meta,
      });
      return { id: s.id, created: true };
    } catch (e) {
      if (isUnique(e)) {
        const again = await this.prisma.attendanceSession.findFirst({
          where: {
            kind,
            groupId: group?.id ?? null,
            date,
            serviceType: { equals: serviceType, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (again) return { id: again.id, created: false };
      }
      throw e;
    }
  }

  async getSheet(user: AuthUser, id: string): Promise<AttendanceSheetDto> {
    this.core.assertView(user);
    const { s, canEdit, where } = await this.sessionContext(user, id);
    const [records, guests] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { sessionId: id },
        select: { memberId: true, broughtCount: true, via: true, checkedInAt: true },
      }),
      this.prisma.guest.findMany({
        where: { sessionId: id },
        include: {
          broughtBy: { select: { id: true, fullName: true } },
          convertedMember: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const presentIds = records.map((r) => r.memberId);
    // Church services are head-counts only: no member roster.
    const roster =
      s.kind === 'CHURCH_SERVICE'
        ? []
        : await this.prisma.member.findMany({
            where: {
              OR: [{ ...where, isActive: true }, ...(presentIds.length ? [{ id: { in: presentIds } }] : [])],
            },
            select: {
              id: true,
              fullName: true,
              churchRole: true,
              constituency: { select: { id: true, name: true } },
              // Team roles only exist in bacentas; for other sessions this matches nothing.
              bacentas: {
                where: { groupId: s.group?.type === 'BACENTA' ? s.group.id : NIL_UUID },
                select: { roles: { select: { role: { select: { id: true, name: true } } } } },
              },
            },
            orderBy: { fullName: 'asc' },
          });
    return {
      session: this.sessionInfo(s),
      roster: roster.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        churchRole: m.churchRole,
        constituency: m.constituency?.name ?? null,
        constituencyId: m.constituency?.id ?? null,
        teamRoles: (m.bacentas ?? []).flatMap((b) => b.roles.map((r) => r.role)),
      })),
      presentIds,
      brought: Object.fromEntries(
        records.filter((r) => r.broughtCount !== null).map((r) => [r.memberId, r.broughtCount!]),
      ),
      checkedIn: Object.fromEntries(
        records.filter((r) => r.via && r.checkedInAt).map((r) => [r.memberId, r.checkedInAt!.toISOString()]),
      ),
      guests: guests.map((g) => this.core.guestDto(g)),
      canEdit,
    };
  }

  /**
   * Saves ticks. Only members in `rosterIds` (the ones whose tick changed) are touched,
   * so two people marking different parts of the same service don't overwrite each other.
   */
  async saveSheet(user: AuthUser, id: string, dto: SheetInput, meta: ReqMeta): Promise<AttendanceSheetDto> {
    const { s, canEdit } = await this.sessionContext(user, id);
    if (!canEdit)
      throw forbidden(
        s.group
          ? 'Only this group’s leaders or a Super Admin can take its attendance'
          : 'Church services are recorded by the ushers or a Super Admin',
      );
    if (dto.date) this.core.checkDate(dto.date);
    if (s.kind === 'CHURCH_SERVICE') return this.saveServiceCounts(user, s, dto, meta);
    const roster = [...new Set(dto.rosterIds)];
    const present = [...new Set(dto.presentIds)].filter((x) => roster.includes(x));
    const existing = new Set(
      (await this.prisma.member.findMany({ where: { id: { in: present } }, select: { id: true } })).map(
        (m) => m.id,
      ),
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.attendanceSession.update({
          where: { id },
          data: {
            visitorCount: dto.visitorCount,
            firstTimerCount: dto.firstTimerCount,
            notes: dto.notes === undefined ? undefined : (blank(dto.notes) ?? null),
            serviceType: dto.serviceType?.trim() || undefined,
            title: dto.title === undefined ? undefined : (blank(dto.title) ?? null),
            date: dto.date ? toDateOnly(dto.date) : undefined,
            recordedById: user.id,
          },
        });
        const absent = roster.filter((x) => !present.includes(x));
        await tx.attendanceRecord.deleteMany({ where: { sessionId: id, memberId: { in: absent } } });
        // Guests brought by someone now marked absent are kept (they did come).
        const add = present.filter((x) => existing.has(x));
        if (add.length)
          await tx.attendanceRecord.createMany({
            data: add.map((memberId) => ({ sessionId: id, memberId })),
            skipDuplicates: true,
          });
      });
    } catch (e) {
      if (isUnique(e))
        throw conflict(
          'SESSION_EXISTS',
          'That service is already recorded for that date. Give this one a different title (e.g. “2nd service”).',
        );
      throw e;
    }
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_SAVED',
      entityType: 'ATTENDANCE',
      entityId: id,
      metadata: {
        serviceType: s.serviceType,
        date: fromDateOnly(s.date),
        changed: roster.length,
        visitors: dto.visitorCount ?? null,
      },
      meta,
    });
    return this.getSheet(user, id);
  }

  /** Church services: the ushers' head-count — total, of which visitors and new converts. */
  private async saveServiceCounts(
    user: AuthUser,
    s: {
      id: string;
      serviceType: string;
      date: Date;
      headcount: number | null;
      visitorCount: number;
      newConvertCount: number;
    },
    dto: SheetInput,
    meta: ReqMeta,
  ) {
    const total = dto.headcount ?? s.headcount ?? 0;
    const visitors = dto.visitorCount ?? s.visitorCount;
    const converts = dto.newConvertCount ?? s.newConvertCount;
    if (visitors + converts > total)
      throw badRequest('COUNTS', 'Visitors and new converts can’t be more than the total');
    const serviceType = dto.serviceType?.trim() || s.serviceType;
    const title = dto.title === undefined ? undefined : (blank(dto.title) ?? null);
    if (
      isPerServiceType(serviceType) &&
      title !== undefined &&
      !SUNDAY_SERVICE_TITLES.some((t) => t === title)
    ) {
      throw badRequest('SERVICE_TITLE', `Choose which service: ${SUNDAY_SERVICE_TITLES.join(' or ')}`);
    }
    try {
      await this.prisma.attendanceSession.update({
        where: { id: s.id },
        data: {
          headcount: total,
          visitorCount: visitors,
          newConvertCount: converts,
          notes: dto.notes === undefined ? undefined : (blank(dto.notes) ?? null),
          serviceType,
          title,
          date: dto.date ? toDateOnly(dto.date) : undefined,
          recordedById: user.id,
        },
      });
    } catch (e) {
      if (isUnique(e)) throw conflict('SESSION_EXISTS', 'That service is already recorded for that date.');
      throw e;
    }
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_SAVED',
      entityType: 'ATTENDANCE',
      entityId: s.id,
      metadata: {
        serviceType,
        date: dto.date ?? fromDateOnly(s.date),
        total,
        visitors,
        newConverts: converts,
      },
      meta,
    });
    return this.getSheet(user, s.id);
  }

  /** Records how many people a member brought (0 = nobody) and who they were. Marks the member present. */
  async saveBrought(
    user: AuthUser,
    id: string,
    memberId: string,
    dto: BroughtInput,
    meta: ReqMeta,
  ): Promise<AttendanceSheetDto> {
    const { s, canEdit } = await this.sessionContext(user, id);
    if (!canEdit) throw forbidden();
    if (s.kind === 'CHURCH_SERVICE')
      throw badRequest(
        'INVALID',
        'Church services are head-counts; record who someone brought in their basonta',
      );
    if (dto.guests.length > dto.broughtCount)
      throw badRequest('INVALID', 'More names than the number brought');
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { fullName: true },
    });
    if (!member) throw notFound('Member');
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.upsert({
        where: { sessionId_memberId: { sessionId: id, memberId } },
        create: { sessionId: id, memberId, broughtCount: dto.broughtCount },
        update: { broughtCount: dto.broughtCount },
      });
      // Replace this member's guests for the session, but never drop one who has become a member.
      await tx.guest.deleteMany({ where: { sessionId: id, broughtById: memberId, convertedMemberId: null } });
      if (dto.guests.length)
        await tx.guest.createMany({
          data: dto.guests.map((g) => ({
            sessionId: id,
            broughtById: memberId,
            fullName: blank(g.fullName) ?? null,
            phone: blank(g.phone)?.replace(/\s+/g, '') ?? null,
            intent: g.intent,
          })),
        });
    });
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_BROUGHT',
      entityType: 'ATTENDANCE',
      entityId: id,
      metadata: { member: member.fullName, broughtCount: dto.broughtCount, date: fromDateOnly(s.date) },
      meta,
    });
    return this.getSheet(user, id);
  }

  async deleteSession(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const { s, canEdit } = await this.sessionContext(user, id);
    if (!canEdit) throw forbidden();
    await this.prisma.attendanceSession.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_DELETED',
      entityType: 'ATTENDANCE',
      entityId: id,
      metadata: { serviceType: s.serviceType, date: fromDateOnly(s.date), group: s.group?.name ?? null },
      meta,
    });
  }

  /** Groups this user leads, shepherds, or heads (basontas under their constituency). */
  private async managedGroupIds(user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.churchGroup.findMany({
      where: {
        OR: [
          ...(user.role === 'PASTOR'
            ? [{ pastorId: user.id }, { createdById: user.id }, { parent: { pastorId: user.id } }]
            : []),
          { shepherds: { some: { userId: user.id } } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Newest first, 10 at a time. `mine`: church services plus the groups this user looks after. */
  async listSessions(
    user: AuthUser,
    q: {
      kind?: AttendanceKind;
      groupId?: string;
      from?: string;
      to?: string;
      mine?: boolean;
      cursor?: string;
      limit?: number;
    },
  ): Promise<Page<SessionRowDto>> {
    this.core.assertView(user);
    const take = pageSize(q.limit);
    const scope: Prisma.AttendanceSessionWhereInput =
      q.mine && !this.policy.canViewChurchStats(user)
        ? { OR: [{ kind: 'CHURCH_SERVICE' }, { groupId: { in: await this.managedGroupIds(user) } }] }
        : {};
    const rows = await this.prisma.attendanceSession.findMany({
      where: {
        ...scope,
        kind: q.kind,
        groupId: q.groupId,
        date: { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined },
      },
      include: {
        group: { select: { id: true, name: true, type: true } },
        _count: { select: { records: true, guests: true } },
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q.cursor, take),
    });
    const { items, nextCursor } = pageOf(rows, take);
    return {
      items: items.map((s) => ({
        id: s.id,
        kind: s.kind,
        serviceType: s.serviceType,
        title: s.title,
        date: fromDateOnly(s.date)!,
        group: s.group,
        present:
          s.kind === 'CHURCH_SERVICE' ? (s.headcount ?? s._count.records + s.visitorCount) : s._count.records,
        visitors: s.visitorCount,
        firstTimers: s.firstTimerCount,
        newConverts: s.newConvertCount,
        guests: s._count.guests,
      })),
      nextCursor,
    };
  }

  /** People brought who want to join and haven't been added as members yet (newest first, 10 at a time). */
  async pendingGuests(
    user: AuthUser,
    q: { cursor?: string; limit?: number } = {},
  ): Promise<Page<GuestDto> & { total: number }> {
    if (!this.policy.canAddMembers(user)) throw forbidden();
    const take = pageSize(q.limit);
    const where: Prisma.GuestWhereInput = { intent: 'JOINING', convertedMemberId: null };
    const [rows, total] = await Promise.all([
      this.prisma.guest.findMany({
        where,
        include: {
          broughtBy: { select: { id: true, fullName: true } },
          convertedMember: { select: { id: true, fullName: true } },
          session: {
            select: {
              id: true,
              date: true,
              serviceType: true,
              title: true,
              group: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, take),
      }),
      this.prisma.guest.count({ where }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    return { items: items.map((g) => this.core.guestDto(g)), nextCursor, total };
  }

  /**
   * One day's attendance by constituency (each the sum of its basontas). Super Admins see
   * everything; head pastors and basonta leaders see only their part.
   */
  async day(user: AuthUser, date: string) {
    this.core.assertView(user);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('INVALID_DATE', 'Choose a valid date');
    const r = await dayRollup(this.prisma, date);
    if (this.policy.canViewChurchStats(user)) return r;
    const mine = (id: string | null, shepherds: string[] = []) =>
      id === user.id || shepherds.includes(user.id);
    return {
      ...r,
      services: r.services,
      bacentas: r.bacentas.filter((b) => mine(b.pastorId)),
      constituencies: r.constituencies
        .map((c) =>
          mine(c.pastorId)
            ? c
            : { ...c, basontas: c.basontas.filter((b) => mine(b.pastorId, b.shepherdIds)) },
        )
        .filter((c) => mine(c.pastorId) || c.basontas.length),
      total: r.constituencies.filter((c) => mine(c.pastorId)).reduce((a, c) => a + (c.present ?? 0), 0),
    };
  }

  async summary(user: AuthUser, q: { from?: string; to?: string }): Promise<AttendanceSummaryDto> {
    if (!this.policy.canViewChurchStats(user))
      throw forbidden(
        'Church-wide reports are for Super Admins. Open one of your groups to see its statistics.',
      );
    const { from, to, f, t } = range(q);

    const [
      activeMembers,
      services,
      byCon,
      constituencies,
      basontas,
      groups,
      groupStats,
      absent,
      guests,
      brought,
    ] = await Promise.all([
      this.prisma.member.count({ where: { isActive: true } }),
      this.prisma.attendanceSession.findMany({
        where: { kind: 'CHURCH_SERVICE', date: { gte: f, lte: t } },
        include: { _count: { select: { records: true, guests: true } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      // Each constituency per meeting day = the sum of its basontas (each member once per basonta).
      this.prisma.$queryRaw<Array<{ id: string; average: number; days: number; last: Date | null }>>`
        SELECT d.cid AS id, round(avg(d.total), 1)::float AS average, count(*)::int AS days, max(d.date) AS last
        FROM (
          SELECT b."parentId" AS cid, x.date, sum(x.n) AS total
          FROM (
            SELECT s."groupId", s."date" AS date, count(DISTINCT r."memberId") AS n
            FROM "AttendanceSession" s LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id
            WHERE s."kind" = 'GROUP_MEETING' AND s."date" BETWEEN ${f}::date AND ${t}::date
            GROUP BY 1, 2) x
          JOIN "ChurchGroup" b ON b.id = x."groupId" AND b."type" = 'BASONTA' AND b."parentId" IS NOT NULL
          GROUP BY 1, 2) d
        GROUP BY 1`,
      this.prisma.churchGroup.findMany({
        where: { type: 'CONSTITUENCY', isActive: true },
        select: { id: true, name: true, _count: { select: { members: { where: { isActive: true } } } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.churchGroup.findMany({
        where: { type: { in: ['BASONTA', 'BACENTA'] }, isActive: true },
        select: { id: true, name: true, type: true, _count: { select: activeCounts } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.churchGroup.findMany({
        where: { isActive: true },
        include: groupInclude,
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.$queryRaw<Array<{ groupId: string; meetings: number; present: number; last: Date | null }>>`
        SELECT s."groupId", count(DISTINCT s.id)::int AS meetings, count(r."memberId")::int AS present, max(s."date") AS last
        FROM "AttendanceSession" s LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id
        WHERE s."kind" = 'GROUP_MEETING' AND s."date" BETWEEN ${f}::date AND ${t}::date
        GROUP BY 1`,
      this.prisma.$queryRaw<
        Array<{ id: string; fullName: string; phone: string | null; constituency: string | null }>
      >`
        SELECT m.id, m."fullName", m.phone, g.name AS constituency
        FROM "Member" m LEFT JOIN "ChurchGroup" g ON g.id = m."constituencyId"
        WHERE m."isActive" AND (m."joinedOn" IS NULL OR m."joinedOn" <= ${f}::date)
          AND NOT EXISTS (
            SELECT 1 FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
            WHERE r."memberId" = m.id AND s."date" BETWEEN ${f}::date AND ${t}::date)
        ORDER BY g.name NULLS LAST, m."fullName"
        LIMIT 300`,
      this.prisma.guest.groupBy({
        by: ['intent'],
        where: { session: { date: { gte: f, lte: t } } },
        _count: { _all: true, convertedMemberId: true },
      }),
      this.prisma.$queryRaw<Array<{ none: number; some: number }>>`
        SELECT count(*) FILTER (WHERE r."broughtCount" = 0)::int AS none, count(*) FILTER (WHERE r."broughtCount" > 0)::int AS some
        FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
        WHERE s."date" BETWEEN ${f}::date AND ${t}::date`,
    ]);

    const conAvg = new Map(byCon.map((r) => [r.id, r]));
    // Services are head-counts (older ones: members ticked + visitors).
    const total = (s: (typeof services)[number]) => s.headcount ?? s._count.records + s.visitorCount;
    const types = new Map<string, { sessions: number; present: number }>();
    for (const s of services) {
      const k = s.serviceType;
      const v = types.get(k) ?? { sessions: 0, present: 0 };
      v.sessions++;
      v.present += total(s);
      types.set(k, v);
    }
    const stats = new Map(groupStats.map((s) => [s.groupId, s]));
    const seen = await this.core.lastSeen(absent.map((a) => a.id));
    const gi = (k: GuestIntent) => guests.find((x) => x.intent === k);
    const anySession = services.length > 0 || groupStats.length > 0;

    return {
      from,
      to,
      activeMembers,
      services: services.map((s) => ({
        id: s.id,
        date: fromDateOnly(s.date)!,
        serviceType: s.serviceType,
        title: s.title,
        total: total(s),
        members: Math.max(0, total(s) - s.visitorCount - s.newConvertCount),
        visitors: s.visitorCount,
        newConverts: s.newConvertCount,
      })),
      constituencyAverages: constituencies.map((c) => ({
        id: c.id,
        name: c.name,
        average: conAvg.get(c.id)?.average ?? 0,
        days: conAvg.get(c.id)?.days ?? 0,
      })),
      serviceTypes: [...types.entries()]
        .map(([serviceType, v]) => ({
          serviceType,
          sessions: v.sessions,
          averagePresent: Math.round((v.present / v.sessions) * 10) / 10,
        }))
        .sort((a, b) => b.sessions - a.sessions),
      constituencies: constituencies.map((c) => ({ id: c.id, name: c.name, members: c._count.members })),
      basontas: basontas
        .filter((c) => c.type === 'BASONTA')
        .map((c) => ({ id: c.id, name: c.name, members: c._count.basontaMembers })),
      bacentas: basontas
        .filter((c) => c.type === 'BACENTA')
        .map((c) => ({ id: c.id, name: c.name, members: c._count.bacentaMembers })),
      groups: groups.map((g) => {
        const s = stats.get(g.id);
        const c = g.type === 'CONSTITUENCY' ? conAvg.get(g.id) : undefined;
        if (g.type === 'CONSTITUENCY')
          return {
            id: g.id,
            type: g.type,
            name: g.name,
            pastor: g.pastor?.fullName ?? null,
            members: countFor(g.type, g._count),
            meetings: c?.days ?? 0,
            averagePresent: c?.average ?? 0,
            lastMeeting: fromDateOnly(c?.last ?? null),
          };
        return {
          id: g.id,
          type: g.type,
          name: g.name,
          pastor: g.pastor?.fullName ?? null,
          members: countFor(g.type, g._count),
          meetings: s?.meetings ?? 0,
          averagePresent: s?.meetings ? Math.round((s.present / s.meetings) * 10) / 10 : 0,
          lastMeeting: fromDateOnly(s?.last ?? null),
        };
      }),
      guests: {
        visit: gi('VISIT')?._count._all ?? 0,
        joining: gi('JOINING')?._count._all ?? 0,
        converted:
          (gi('VISIT')?._count.convertedMemberId ?? 0) + (gi('JOINING')?._count.convertedMemberId ?? 0),
        broughtNone: brought[0]?.none ?? 0,
        broughtSome: brought[0]?.some ?? 0,
      },
      absentees: anySession ? absent.map((a) => ({ ...a, lastSeen: seen.get(a.id) ?? null })) : [],
    };
  }
}
