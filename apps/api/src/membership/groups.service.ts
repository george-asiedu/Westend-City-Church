import { Injectable } from '@nestjs/common';
import { Prisma, dayRollup, type GroupType, type GuestIntent } from '@wcc/db';
import type { GroupDto, GroupStatsDto, LeaderDto, Page, PastorDto, UpcomingBirthdayDto } from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, fromDateOnly, pageOf, pageSize, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import {
  pastorSelect,
  groupInclude,
  GroupRow,
  ref,
  countFor,
  memberWhereFor,
  GroupInput,
  today,
  blank,
  conflict,
  isUnique,
  range,
  MembershipCore,
} from './core';
import { MembersService } from './members.service';

/** Constituencies, basontas and bacentas: details, leaders, teams, who is in them, stats and birthdays. */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly core: MembershipCore,
    private readonly members: MembersService,
  ) {}

  private async groupDtos(user: AuthUser, groups: GroupRow[]): Promise<GroupDto[]> {
    const ids = groups.map((g) => g.id);
    const last = ids.length
      ? await this.prisma.attendanceSession.findMany({
          where: { kind: 'GROUP_MEETING', groupId: { in: ids } },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          distinct: ['groupId'],
          select: { id: true, groupId: true, date: true, _count: { select: { records: true } } },
        })
      : [];
    const lastBy = new Map(last.map((l) => [l.groupId!, l]));
    return groups.map((g) => {
      const l = lastBy.get(g.id);
      const r = ref(g);
      return {
        id: g.id,
        type: g.type,
        name: g.name,
        description: g.description,
        meetingDay: g.meetingDay,
        meetingPlace: g.meetingPlace,
        isActive: g.isActive,
        pastor: g.pastor as PastorDto | null,
        shepherds: g.shepherds.map((s) => s.user as PastorDto),
        parent: g.parent
          ? { id: g.parent.id, name: g.parent.name, pastor: g.parent.pastor as PastorDto | null }
          : null,
        children: g.children.map((c) => ({
          id: c.id,
          name: c.name,
          pastor: c.pastor?.fullName ?? null,
          memberCount: c._count.basontaMembers,
        })),
        roles: g.roles.map((r) => ({ id: r.id, name: r.name, memberCount: r._count.members, lead: r.lead })),
        lead: g.leadMember,
        recordsServices: g.recordsServices,
        memberCount: countFor(g.type, g._count),
        lastMeeting: l ? { id: l.id, date: fromDateOnly(l.date)!, present: l._count.records } : null,
        canManage: this.policy.canManageGroup(user, r),
        canAdminister: this.policy.canAdministerGroup(user, r),
      };
    });
  }

  async listGroups(user: AuthUser, type?: GroupType): Promise<GroupDto[]> {
    this.core.assertView(user);
    const groups = await this.prisma.churchGroup.findMany({
      where: type ? { type } : {},
      include: groupInclude,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return this.groupDtos(user, groups);
  }

  async getGroup(user: AuthUser, id: string): Promise<GroupDto & { createdAt: Date }> {
    this.core.assertView(user);
    const g = await this.prisma.churchGroup.findUnique({ where: { id }, include: groupInclude });
    if (!g) throw notFound('Group');
    const [dto] = await this.groupDtos(user, [g]);
    return { ...dto!, createdAt: g.createdAt };
  }

  /** Users who can be picked as pastor (admins) — a pastor only sees themself. */
  async pastors(user: AuthUser): Promise<PastorDto[]> {
    if (!this.policy.canAssignPastor(user))
      return user.role === 'PASTOR'
        ? this.prisma.user.findMany({ where: { id: user.id }, select: pastorSelect })
        : [];
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['PASTOR', 'SUPER_ADMIN'] } },
      select: pastorSelect,
      orderBy: { fullName: 'asc' },
    });
  }

  /** Users who can be made shepherds of a group. */
  async shepherdCandidates(user: AuthUser): Promise<PastorDto[]> {
    if (!this.policy.canCreateGroup(user)) return [];
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['SHEPHERD', 'PASTOR'] } },
      select: pastorSelect,
      orderBy: { fullName: 'asc' },
    });
  }

  private async resolvePastor(
    user: AuthUser,
    pastorId: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (pastorId === undefined) return undefined;
    if (!this.policy.canAssignPastor(user)) {
      if (pastorId !== null && pastorId !== user.id)
        throw forbidden('Only a Super Admin can choose another pastor');
      return pastorId;
    }
    if (pastorId === null) return null;
    const p = await this.prisma.user.findUnique({ where: { id: pastorId }, select: { status: true } });
    if (!p || p.status !== 'ACTIVE') throw badRequest('PASTOR_INVALID', 'Choose an active user as pastor');
    return pastorId;
  }

  async createGroup(user: AuthUser, dto: GroupInput, meta: ReqMeta): Promise<GroupDto> {
    if (!dto.type || !dto.name?.trim()) throw badRequest('INVALID', 'Type and name are required');
    let parentId: string | null = null;
    if (dto.type === 'BASONTA') {
      if (!dto.parentId) throw badRequest('PARENT_REQUIRED', 'Choose the constituency this basonta is under');
      const parent = await this.prisma.churchGroup.findUnique({
        where: { id: dto.parentId },
        select: { type: true, pastorId: true },
      });
      if (parent?.type !== 'CONSTITUENCY') throw badRequest('PARENT_INVALID', 'Choose a valid constituency');
      if (!this.policy.canCreateGroupOfType(user, 'BASONTA', parent))
        throw forbidden('Only the constituency’s head pastor or a Super Admin can add basontas to it');
      parentId = dto.parentId;
    } else if (!this.policy.canCreateGroupOfType(user, dto.type)) {
      throw forbidden(
        dto.type === 'CONSTITUENCY'
          ? 'Only a Super Admin can create constituencies'
          : 'Only pastors and Super Admins can create bacentas',
      );
    }
    if (!this.policy.canAssignPastor(user) && dto.pastorId && dto.pastorId !== user.id)
      throw forbidden('Only a Super Admin can choose another pastor');
    // A pastor creating a bacenta leads it; a head pastor creating a basonta may leave it to
    // be led by someone else later; admins may pick anyone (default: none).
    const pastorId = this.policy.canAssignPastor(user)
      ? await this.resolvePastor(user, dto.pastorId ?? null)
      : dto.type === 'BASONTA'
        ? dto.pastorId === user.id
          ? user.id
          : null
        : user.id;
    try {
      const g = await this.prisma.churchGroup.create({
        data: {
          type: dto.type,
          name: dto.name.trim(),
          description: blank(dto.description) ?? null,
          meetingDay: blank(dto.meetingDay) ?? null,
          meetingPlace: blank(dto.meetingPlace) ?? null,
          pastorId,
          parentId,
          createdById: user.id,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'GROUP_CREATED',
        entityType: 'GROUP',
        entityId: g.id,
        metadata: { type: g.type, name: g.name },
        meta,
      });
      return this.getGroup(user, g.id);
    } catch (e) {
      if (isUnique(e))
        throw conflict(
          'GROUP_EXISTS',
          `A ${dto.type.toLowerCase()} called “${dto.name.trim()}” already exists`,
        );
      throw e;
    }
  }

  private async loadAdministeredGroup(user: AuthUser, id: string) {
    const g = await this.core.loadGroup(id);
    if (!this.policy.canAdministerGroup(user, ref(g)))
      throw forbidden('Only this group’s pastor or a Super Admin can do that');
    return g;
  }

  async updateGroup(user: AuthUser, id: string, dto: GroupInput, meta: ReqMeta): Promise<GroupDto> {
    const before = await this.loadAdministeredGroup(user, id);
    const pastorId = await this.resolvePastor(user, dto.pastorId);
    if (dto.recordsServices !== undefined) {
      if (!this.policy.isMembershipAdmin(user))
        throw forbidden('Only a Super Admin can choose who records church services');
      if (before.type !== 'BACENTA')
        throw badRequest('INVALID', 'Only a bacenta (e.g. the Ushers) records church services');
    }
    if (dto.leadMemberId) {
      if (before.type !== 'BACENTA') throw badRequest('INVALID', 'Only bacentas have a team lead');
      const inIt = await this.prisma.memberBacenta.findUnique({
        where: { memberId_groupId: { memberId: dto.leadMemberId, groupId: id } },
      });
      if (!inIt) throw badRequest('LEAD_INVALID', 'The team lead must be a member of this bacenta');
    }
    let parentId: string | undefined;
    if (
      dto.parentId !== undefined &&
      before.type === 'BASONTA' &&
      dto.parentId &&
      dto.parentId !== before.parentId
    ) {
      const parent = await this.prisma.churchGroup.findUnique({
        where: { id: dto.parentId },
        select: { type: true, pastorId: true },
      });
      if (parent?.type !== 'CONSTITUENCY') throw badRequest('PARENT_INVALID', 'Choose a valid constituency');
      if (!this.policy.canCreateGroupOfType(user, 'BASONTA', parent))
        throw forbidden('You can only move a basonta into a constituency you lead');
      parentId = dto.parentId;
    }
    try {
      await this.prisma.churchGroup.update({
        where: { id },
        data: {
          name: dto.name?.trim() || undefined,
          description: blank(dto.description),
          meetingDay: blank(dto.meetingDay),
          meetingPlace: blank(dto.meetingPlace),
          isActive: dto.isActive,
          pastorId,
          parentId,
          leadMemberId: dto.leadMemberId,
          recordsServices: dto.recordsServices,
        },
      });
      // Members of a basonta that moved follow it to its new constituency.
      if (parentId)
        await this.prisma.member.updateMany({ where: { basontaId: id }, data: { constituencyId: parentId } });
    } catch (e) {
      if (isUnique(e)) throw conflict('GROUP_EXISTS', 'Another group already has that name');
      throw e;
    }
    await this.audit.record({
      actorId: user.id,
      action: 'GROUP_UPDATED',
      entityType: 'GROUP',
      entityId: id,
      metadata: { before: { name: before.name, pastorId: before.pastorId }, after: { ...dto } },
      meta,
    });
    return this.getGroup(user, id);
  }

  async deleteGroup(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const g = await this.loadAdministeredGroup(user, id);
    await this.prisma.churchGroup.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'GROUP_DELETED',
      entityType: 'GROUP',
      entityId: id,
      metadata: { type: g.type, name: g.name },
      meta,
    });
  }

  async addShepherd(user: AuthUser, groupId: string, userId: string, meta: ReqMeta): Promise<GroupDto> {
    await this.loadAdministeredGroup(user, groupId);
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true, fullName: true },
    });
    if (!u || u.status !== 'ACTIVE' || (u.role !== 'SHEPHERD' && u.role !== 'PASTOR'))
      throw badRequest('SHEPHERD_INVALID', 'Choose an active user with the Shepherd or Pastor role');
    await this.prisma.groupShepherd.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { groupId, userId },
      update: {},
    });
    await this.audit.record({
      actorId: user.id,
      action: 'GROUP_SHEPHERD_ADDED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { userId, fullName: u.fullName },
      meta,
    });
    return this.getGroup(user, groupId);
  }

  async removeShepherd(user: AuthUser, groupId: string, userId: string, meta: ReqMeta): Promise<GroupDto> {
    await this.loadAdministeredGroup(user, groupId);
    await this.prisma.groupShepherd.deleteMany({ where: { groupId, userId } });
    await this.audit.record({
      actorId: user.id,
      action: 'GROUP_SHEPHERD_REMOVED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { userId },
      meta,
    });
    return this.getGroup(user, groupId);
  }

  /** Charts for one group: shown to its pastor, shepherds and admins. */
  async groupStats(user: AuthUser, id: string, q: { from?: string; to?: string }): Promise<GroupStatsDto> {
    const g = await this.core.loadGroup(id);
    if (!this.policy.canManageGroup(user, ref(g)) && !this.policy.canViewChurchStats(user))
      throw forbidden('Only this group’s leaders can see its statistics');
    const { from, to, f, t } = range(q, 90);
    const memberWhere: Prisma.MemberWhereInput = { ...memberWhereFor(g), isActive: true };
    const [members, sessions, roles, guests, teamRoles, noRole] = await Promise.all([
      this.prisma.member.count({ where: memberWhere }),
      this.prisma.attendanceSession.findMany({
        where: { groupId: id, date: { gte: f, lte: t } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          date: true,
          serviceType: true,
          title: true,
          visitorCount: true,
          _count: { select: { records: true, guests: true } },
        },
      }),
      this.prisma.member.groupBy({
        by: ['churchRole'],
        where: memberWhere,
        _count: { _all: true },
        orderBy: { _count: { churchRole: 'desc' } },
      }),
      this.prisma.guest.groupBy({
        by: ['intent'],
        where: { session: { date: { gte: f, lte: t } }, broughtBy: memberWhere },
        _count: { _all: true, convertedMemberId: true },
      }),
      g.type === 'BACENTA'
        ? this.prisma.bacentaRole.findMany({
            where: { groupId: id },
            select: {
              id: true,
              name: true,
              _count: { select: { members: { where: { membership: { member: { isActive: true } } } } } },
            },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          })
        : Promise.resolve([]),
      g.type === 'BACENTA'
        ? this.prisma.memberBacenta.count({
            where: { groupId: id, member: { isActive: true }, roles: { none: {} } },
          })
        : Promise.resolve(0),
    ]);
    let meetings = sessions.map((s) => ({
      id: s.id,
      date: fromDateOnly(s.date)!,
      serviceType: s.serviceType,
      title: s.title,
      present: s._count.records,
      visitors: s.visitorCount,
      guests: s._count.guests,
    }));
    // A constituency with basontas counts the sum of its basontas on each date.
    const basontaIds =
      g.type === 'CONSTITUENCY'
        ? (
            await this.prisma.churchGroup.findMany({
              where: { parentId: id, type: 'BASONTA' },
              select: { id: true },
            })
          ).map((b) => b.id)
        : [];
    if (basontaIds.length) {
      const days = await this.prisma.$queryRaw<
        Array<{ date: Date; present: number; visitors: number; guests: number; recorded: number }>
      >`
        SELECT d.date, sum(d.present)::int AS present, sum(d.visitors)::int AS visitors, sum(d.guests)::int AS guests, count(*)::int AS recorded
        FROM (
          SELECT s."groupId", s."date",
                 count(DISTINCT r."memberId") AS present,
                 (SELECT coalesce(sum(s2."visitorCount"), 0) FROM "AttendanceSession" s2 WHERE s2."groupId" = s."groupId" AND s2."date" = s."date") AS visitors,
                 (SELECT count(*) FROM "Guest" gu JOIN "AttendanceSession" s3 ON s3.id = gu."sessionId" WHERE s3."groupId" = s."groupId" AND s3."date" = s."date") AS guests
          FROM "AttendanceSession" s LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id
          WHERE s."groupId" = ANY(${basontaIds}::uuid[]) AND s."date" BETWEEN ${f}::date AND ${t}::date
          GROUP BY s."groupId", s."date") d
        GROUP BY d.date ORDER BY d.date`;
      meetings = days.map((d) => ({
        id: `day-${fromDateOnly(d.date)}`,
        date: fromDateOnly(d.date)!,
        serviceType: `${d.recorded} of ${basontaIds.length} basontas`,
        title: null,
        present: d.present,
        visitors: d.visitors,
        guests: d.guests,
      }));
    }
    const last = meetings[meetings.length - 1];
    const gi = (k: GuestIntent) => guests.find((x) => x.intent === k);
    return {
      from,
      to,
      members,
      meetings,
      averagePresent: meetings.length
        ? Math.round((meetings.reduce((a, m) => a + m.present, 0) / meetings.length) * 10) / 10
        : 0,
      lastMeeting: last
        ? { id: last.id, date: last.date, present: last.present, absent: Math.max(0, members - last.present) }
        : null,
      sumOfBasontas: basontaIds.length > 0,
      roles: roles.map((r) => ({ role: r.churchRole, count: r._count._all })),
      teamRoles: [
        ...teamRoles.map((r) => ({ id: r.id, name: r.name, count: r._count.members })),
        ...(g.type === 'BACENTA' && noRole ? [{ id: null, name: 'No role yet', count: noRole }] : []),
      ],
      guests: {
        visit: gi('VISIT')?._count._all ?? 0,
        joining: gi('JOINING')?._count._all ?? 0,
        converted:
          (gi('VISIT')?._count.convertedMemberId ?? 0) + (gi('JOINING')?._count.convertedMemberId ?? 0),
      },
    };
  }

  /**
   * Super Admin: pastors and shepherds (newest first), 10 at a time, with the groups they
   * lead or shepherd. Stats cover everyone, whatever the filters.
   */
  async leaders(
    user: AuthUser,
    q: {
      cursor?: string;
      limit?: number;
      q?: string;
      role?: 'PASTOR' | 'SHEPHERD';
      show?: 'new' | 'unassigned';
    },
  ): Promise<
    Page<LeaderDto> & {
      stats: {
        pastors: number;
        shepherds: number;
        newPastors: number;
        newShepherds: number;
        unassigned: number;
        neverSignedIn: number;
      };
    }
  > {
    if (!this.policy.canViewLeaders(user)) throw forbidden();
    const NEW_SINCE = new Date(Date.now() - 30 * 86_400_000);
    const base: Prisma.UserWhereInput = {
      OR: [{ role: { in: ['PASTOR', 'SHEPHERD'] } }, { pastoredGroups: { some: {} } }],
    };
    const unassigned: Prisma.UserWhereInput = { pastoredGroups: { none: {} }, shepherding: { none: {} } };
    const term = q.q?.trim();
    const where: Prisma.UserWhereInput = {
      AND: [
        base,
        q.role ? { role: q.role } : {},
        q.show === 'new' ? { createdAt: { gte: NEW_SINCE } } : q.show === 'unassigned' ? unassigned : {},
        term
          ? {
              OR: [
                { fullName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
              ],
            }
          : {},
      ],
    };
    const take = pageSize(q.limit);
    const [rows, total, pastors, shepherds, newPastors, newShepherds, unassignedN, neverSignedIn] =
      await Promise.all([
        this.prisma.user.findMany({
          where,
          select: {
            ...pastorSelect,
            role: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            pastoredGroups: { select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } },
            shepherding: { select: { group: { select: { id: true, name: true, type: true } } } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...cursorArgs(q.cursor, take),
        }),
        this.prisma.user.count({ where }),
        this.prisma.user.count({ where: { role: 'PASTOR' } }),
        this.prisma.user.count({ where: { role: 'SHEPHERD' } }),
        this.prisma.user.count({ where: { role: 'PASTOR', createdAt: { gte: NEW_SINCE } } }),
        this.prisma.user.count({ where: { role: 'SHEPHERD', createdAt: { gte: NEW_SINCE } } }),
        this.prisma.user.count({ where: { AND: [base, unassigned] } }),
        this.prisma.user.count({ where: { AND: [base, { lastLoginAt: null }] } }),
      ]);
    const { items, nextCursor } = pageOf(rows, take);
    return {
      items: items.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        title: u.title,
        phone: u.phone,
        email: u.email,
        role: u.role as LeaderDto['role'],
        status: u.status,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        leads: u.pastoredGroups,
        shepherds: u.shepherding.map((x) => x.group).sort((a, b) => a.name.localeCompare(b.name)),
      })),
      nextCursor,
      total,
      stats: { pastors, shepherds, newPastors, newShepherds, unassigned: unassignedN, neverSignedIn },
    };
  }

  /** Members of a group with a birthday in the next `days` days (today included), soonest first. */
  async upcomingBirthdays(
    user: AuthUser,
    id: string,
    days = 30,
    asMember = false,
  ): Promise<UpcomingBirthdayDto[]> {
    if (!asMember) this.core.assertView(user);
    const g = await this.core.loadGroup(id);
    const rows = await this.prisma.member.findMany({
      where: { ...memberWhereFor(g), isActive: true, dateOfBirth: { not: null } },
      select: { id: true, fullName: true, phone: true, dateOfBirth: true },
    });
    const today = toDateOnly(new Date().toISOString().slice(0, 10));
    const y = today.getUTCFullYear();
    const leap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
    const next = (dob: Date) => {
      for (const yr of [y, y + 1]) {
        let m = dob.getUTCMonth();
        let d = dob.getUTCDate();
        if (m === 1 && d === 29 && !leap(yr)) d = 28; // 29 Feb → 28 Feb in other years
        const at = new Date(Date.UTC(yr, m, d));
        if (at >= today) return at;
      }
      return null;
    };
    return rows
      .map((r) => {
        const at = next(r.dateOfBirth!)!;
        const daysAway = Math.round((at.getTime() - today.getTime()) / 86_400_000);
        const born = r.dateOfBirth!.getUTCFullYear();
        return {
          id: r.id,
          fullName: r.fullName,
          phone: r.phone,
          date: fromDateOnly(at)!,
          daysAway,
          turning: born > 1900 ? at.getUTCFullYear() - born : null,
        };
      })
      .filter((r) => r.daysAway <= days)
      .sort((a, b) => a.daysAway - b.daysAway || a.fullName.localeCompare(b.fullName));
  }

  /**
   * Super Admin: ask the leaders of basontas that haven't recorded `date` to do it now.
   * Returns how many leaders will be asked and how many of them have notifications on.
   */
  async remindGroups(user: AuthUser, date: string, groupIds: string[], meta: ReqMeta) {
    if (!this.policy.isMembershipAdmin(user)) throw forbidden('Only a Super Admin can send reminders');
    this.core.checkDate(date);
    const r = await dayRollup(this.prisma, date);
    const missing = r.constituencies
      .flatMap((c) => c.basontas)
      .filter((b) => groupIds.includes(b.id) && b.present === null);
    const leaders = [
      ...new Set(missing.flatMap((b) => [b.pastorId, ...b.shepherdIds]).filter((u): u is string => !!u)),
    ];
    const withDevices = leaders.length
      ? (
          await this.prisma.pushSubscription.findMany({
            where: { userId: { in: leaders }, user: { notifyReminders: true, status: 'ACTIVE' } },
            distinct: ['userId'],
            select: { userId: true },
          })
        ).length
      : 0;
    if (leaders.length)
      await this.queue.remindGroups({ date, groupIds: missing.map((b) => b.id), requestedBy: user.id });
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_REMINDER_SENT',
      entityType: 'ATTENDANCE',
      metadata: { date, basontas: missing.map((b) => b.name), leaders: leaders.length },
      meta,
    });
    return {
      basontas: missing.length,
      leaders: leaders.length,
      withDevices,
      noLeader: missing.filter((b) => !b.pastorId && !b.shepherdIds.length).map((b) => b.name),
    };
  }

  // ---------------------------------------------------------------- bacenta team roles

  private async loadBacenta(user: AuthUser, id: string, administer = false) {
    const g = await this.core.loadGroup(id);
    if (g.type !== 'BACENTA') throw badRequest('INVALID', 'Team roles are for bacentas');
    const r = ref(g);
    if (!(administer ? this.policy.canAdministerGroup(user, r) : this.policy.canManageGroup(user, r)))
      throw forbidden('Only this bacenta’s leaders or a Super Admin can do that');
    return g;
  }

  private async checkLead(groupId: string, leadId: string | null | undefined) {
    if (!leadId) return;
    const inIt = await this.prisma.memberBacenta.findUnique({
      where: { memberId_groupId: { memberId: leadId, groupId } },
    });
    if (!inIt) throw badRequest('LEAD_INVALID', 'The team lead must be a member of this bacenta');
  }

  async createRole(
    user: AuthUser,
    groupId: string,
    dto: { name: string; leadId?: string | null },
    meta: ReqMeta,
  ): Promise<GroupDto> {
    await this.loadBacenta(user, groupId);
    await this.checkLead(groupId, dto.leadId);
    const last = await this.prisma.bacentaRole.aggregate({ where: { groupId }, _max: { sortOrder: true } });
    try {
      await this.prisma.bacentaRole.create({
        data: {
          groupId,
          name: dto.name.trim(),
          leadId: dto.leadId ?? null,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
        },
      });
    } catch (e) {
      if (isUnique(e)) throw conflict('ROLE_EXISTS', `There is already a “${dto.name.trim()}” team`);
      throw e;
    }
    await this.audit.record({
      actorId: user.id,
      action: 'TEAM_ROLE_CREATED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { name: dto.name.trim() },
      meta,
    });
    return this.getGroup(user, groupId);
  }

  async updateRole(
    user: AuthUser,
    groupId: string,
    roleId: string,
    dto: { name?: string; leadId?: string | null },
    meta: ReqMeta,
  ): Promise<GroupDto> {
    await this.loadBacenta(user, groupId);
    await this.checkLead(groupId, dto.leadId);
    const r = await this.prisma.bacentaRole.findUnique({ where: { id: roleId } });
    if (!r || r.groupId !== groupId) throw notFound('Team role');
    try {
      await this.prisma.bacentaRole.update({
        where: { id: roleId },
        data: { name: dto.name?.trim() || undefined, leadId: dto.leadId },
      });
    } catch (e) {
      if (isUnique(e)) throw conflict('ROLE_EXISTS', 'Another team already has that name');
      throw e;
    }
    await this.audit.record({
      actorId: user.id,
      action: 'TEAM_ROLE_UPDATED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { roleId, ...dto },
      meta,
    });
    return this.getGroup(user, groupId);
  }

  async deleteRole(user: AuthUser, groupId: string, roleId: string, meta: ReqMeta): Promise<GroupDto> {
    await this.loadBacenta(user, groupId);
    const r = await this.prisma.bacentaRole.findUnique({ where: { id: roleId } });
    if (!r || r.groupId !== groupId) throw notFound('Team role');
    await this.prisma.bacentaRole.delete({ where: { id: roleId } });
    await this.audit.record({
      actorId: user.id,
      action: 'TEAM_ROLE_DELETED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { name: r.name },
      meta,
    });
    return this.getGroup(user, groupId);
  }

  // ---------------------------------------------------------------- group membership (existing members)

  /**
   * Puts an existing member into a group. Bacenta: adds them (with team roles).
   * Basonta: makes it their basonta (and its constituency theirs). Constituency: makes it
   * theirs (dropping a basonta from another constituency).
   */
  async addToGroup(
    user: AuthUser,
    groupId: string,
    memberId: string,
    roleIds: string[] | undefined,
    meta: ReqMeta,
  ) {
    const g = await this.core.loadGroup(groupId);
    if (!this.policy.canManageGroup(user, ref(g)))
      throw forbidden('Only this group’s leaders or a Super Admin can add members to it');
    const m = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { id: true, fullName: true, constituencyId: true, basontaId: true },
    });
    if (!m) throw notFound('Member');
    if (g.type === 'BACENTA') {
      if (roleIds?.length) {
        const n = await this.prisma.bacentaRole.count({ where: { id: { in: roleIds }, groupId } });
        if (n !== new Set(roleIds).size)
          throw badRequest('ROLE_INVALID', 'A team role doesn’t belong to this bacenta');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.memberBacenta.upsert({
          where: { memberId_groupId: { memberId, groupId } },
          create: { memberId, groupId },
          update: {},
        });
        if (roleIds) {
          await tx.memberBacentaRole.deleteMany({ where: { memberId, groupId } });
          if (roleIds.length)
            await tx.memberBacentaRole.createMany({
              data: [...new Set(roleIds)].map((roleId) => ({ memberId, groupId, roleId })),
            });
        }
      });
    } else if (g.type === 'BASONTA') {
      await this.prisma.member.update({
        where: { id: memberId },
        data: { basontaId: groupId, ...(g.parentId ? { constituencyId: g.parentId } : {}) },
      });
    } else {
      const keepBasonta = m.basontaId
        ? (
            await this.prisma.churchGroup.findUnique({
              where: { id: m.basontaId },
              select: { parentId: true },
            })
          )?.parentId === groupId
        : false;
      await this.prisma.member.update({
        where: { id: memberId },
        data: { constituencyId: groupId, ...(keepBasonta ? {} : { basontaId: null }) },
      });
    }
    await this.audit.record({
      actorId: user.id,
      action: 'GROUP_MEMBER_ADDED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { member: m.fullName, roleIds: roleIds ?? null },
      meta,
    });
    return this.members.getMember(user, memberId);
  }

  async removeFromGroup(user: AuthUser, groupId: string, memberId: string, meta: ReqMeta) {
    const g = await this.core.loadGroup(groupId);
    if (!this.policy.canManageGroup(user, ref(g))) throw forbidden();
    const m = await this.prisma.member.findUnique({ where: { id: memberId }, select: { fullName: true } });
    if (!m) throw notFound('Member');
    if (g.type === 'BACENTA') {
      await this.prisma.$transaction([
        this.prisma.memberBacenta.deleteMany({ where: { memberId, groupId } }),
        this.prisma.bacentaRole.updateMany({ where: { groupId, leadId: memberId }, data: { leadId: null } }),
        this.prisma.churchGroup.updateMany({
          where: { id: groupId, leadMemberId: memberId },
          data: { leadMemberId: null },
        }),
      ]);
    } else if (g.type === 'BASONTA')
      await this.prisma.member.updateMany({
        where: { id: memberId, basontaId: groupId },
        data: { basontaId: null },
      });
    else
      await this.prisma.member.updateMany({
        where: { id: memberId, constituencyId: groupId },
        data: { constituencyId: null, basontaId: null },
      });
    await this.audit.record({
      actorId: user.id,
      action: 'GROUP_MEMBER_REMOVED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { member: m.fullName },
      meta,
    });
  }

  /** Sets a member's team roles in a bacenta. */
  async setMemberRoles(user: AuthUser, groupId: string, memberId: string, roleIds: string[], meta: ReqMeta) {
    return this.addToGroup(user, groupId, memberId, roleIds, meta);
  }
}
