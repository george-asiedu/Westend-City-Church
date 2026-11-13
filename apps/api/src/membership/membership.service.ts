import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type GroupType, type AttendanceKind, type GuestIntent } from '@wcc/db';
import type {
  AttendanceSheetDto,
  AttendanceSummaryDto,
  GroupDto,
  GroupStatsDto,
  GuestDto,
  LeaderDto,
  MemberDto,
  PastorDto,
  SessionInfoDto,
  SessionRowDto,
} from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService, type GroupRef } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { fromDateOnly, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

const pastorSelect = { id: true, fullName: true, title: true, phone: true, email: true } as const;
const groupRefSelect = { id: true, name: true, pastorId: true, createdById: true, shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } } as const;
const memberInclude = {
  constituency: { select: groupRefSelect },
  basonta: { select: groupRefSelect },
  bacentas: { include: { group: { select: groupRefSelect }, roles: { include: { role: { select: { id: true, name: true, sortOrder: true } } } } } },
} as const;
type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;
const activeCounts = {
  members: { where: { isActive: true } },
  basontaMembers: { where: { isActive: true } },
  bacentaMembers: { where: { member: { isActive: true } } },
} as const;
const groupInclude = {
  pastor: { select: pastorSelect },
  shepherds: { select: { user: { select: pastorSelect } }, orderBy: { createdAt: 'asc' } },
  parent: { select: { id: true, name: true, pastorId: true, pastor: { select: pastorSelect } } },
  children: { select: { id: true, name: true, isActive: true, pastor: { select: { fullName: true } }, _count: { select: { basontaMembers: { where: { isActive: true } } } } }, orderBy: { name: 'asc' } },
  roles: { select: { id: true, name: true, lead: { select: { id: true, fullName: true, phone: true } }, _count: { select: { members: true } } }, orderBy: { sortOrder: 'asc' } },
  leadMember: { select: { id: true, fullName: true, phone: true } },
  _count: { select: activeCounts },
} as const;
type GroupRow = Prisma.ChurchGroupGetPayload<{ include: typeof groupInclude }>;

/** Policy view of a group row. */
const ref = (g: {
  pastorId: string | null;
  createdById: string | null;
  shepherds: Array<{ userId?: string; user?: { id: string } }>;
  parent?: { pastorId: string | null } | null;
}): GroupRef => ({
  pastorId: g.pastorId,
  createdById: g.createdById,
  shepherdIds: g.shepherds.map((s) => s.userId ?? s.user!.id),
  parentPastorId: g.parent?.pastorId ?? null,
});

const countFor = (type: GroupType, c: { members: number; basontaMembers: number; bacentaMembers: number }) =>
  type === 'CONSTITUENCY' ? c.members : type === 'BASONTA' ? c.basontaMembers : c.bacentaMembers;

/** Members of a group, by type. */
const memberWhereFor = (g: { id: string; type: GroupType }): Prisma.MemberWhereInput =>
  g.type === 'CONSTITUENCY' ? { constituencyId: g.id } : g.type === 'BASONTA' ? { basontaId: g.id } : { bacentas: { some: { groupId: g.id } } };

export interface GroupInput {
  type?: GroupType;
  name?: string;
  description?: string | null;
  meetingDay?: string | null;
  meetingPlace?: string | null;
  pastorId?: string | null;
  /** A basonta's constituency. */
  parentId?: string | null;
  /** A bacenta's overall team lead (must be one of its members). */
  leadMemberId?: string | null;
  isActive?: boolean;
}
export interface MemberInput {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  location?: string | null;
  churchRole?: string;
  constituencyId?: string | null;
  basontaId?: string | null;
  /** Bacentas they serve in, with team roles in each. Replaces all when given. */
  bacentas?: Array<{ groupId: string; roleIds?: string[] }>;
  joinedOn?: string | null;
  isActive?: boolean;
  notes?: string | null;
  /** Creating a member from someone who was brought as a guest. */
  fromGuestId?: string;
}
export interface SessionInput {
  groupId?: string | null;
  serviceType: string;
  title?: string | null;
  date: string;
}
export interface SheetInput {
  presentIds: string[];
  rosterIds: string[];
  visitorCount?: number;
  firstTimerCount?: number;
  notes?: string | null;
  serviceType?: string;
  title?: string | null;
  date?: string;
}
export interface BroughtInput {
  broughtCount: number;
  guests: Array<{ fullName?: string | null; phone?: string | null; intent: GuestIntent }>;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const today = () => new Date().toISOString().slice(0, 10);
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);
const conflict = (code: string, msg: string) => new AppException(HttpStatus.CONFLICT, code, msg);
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const range = (q: { from?: string; to?: string }, days = 55) => {
  const to = q.to ?? today();
  const from = q.from ?? new Date(Date.parse(to) - days * 86_400_000).toISOString().slice(0, 10);
  if (from > to) throw badRequest('INVALID_RANGE', '“From” must be before “To”');
  return { from, to, f: toDateOnly(from), t: toDateOnly(to) };
};

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private assertView(user: AuthUser) {
    if (!this.policy.canViewMembership(user)) throw forbidden('You do not have access to membership records');
  }

  // ---------------------------------------------------------------- groups

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
        parent: g.parent ? { id: g.parent.id, name: g.parent.name, pastor: g.parent.pastor as PastorDto | null } : null,
        children: g.children.map((c) => ({ id: c.id, name: c.name, pastor: c.pastor?.fullName ?? null, memberCount: c._count.basontaMembers })),
        roles: g.roles.map((r) => ({ id: r.id, name: r.name, memberCount: r._count.members, lead: r.lead })),
        lead: g.leadMember,
        memberCount: countFor(g.type, g._count),
        lastMeeting: l ? { id: l.id, date: fromDateOnly(l.date)!, present: l._count.records } : null,
        canManage: this.policy.canManageGroup(user, r),
        canAdminister: this.policy.canAdministerGroup(user, r),
      };
    });
  }

  async listGroups(user: AuthUser, type?: GroupType): Promise<GroupDto[]> {
    this.assertView(user);
    const groups = await this.prisma.churchGroup.findMany({ where: type ? { type } : {}, include: groupInclude, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    return this.groupDtos(user, groups);
  }

  async getGroup(user: AuthUser, id: string): Promise<GroupDto & { createdAt: Date }> {
    this.assertView(user);
    const g = await this.prisma.churchGroup.findUnique({ where: { id }, include: groupInclude });
    if (!g) throw notFound('Group');
    const [dto] = await this.groupDtos(user, [g]);
    return { ...dto!, createdAt: g.createdAt };
  }

  /** Users who can be picked as pastor (admins) — a pastor only sees themself. */
  async pastors(user: AuthUser): Promise<PastorDto[]> {
    if (!this.policy.canAssignPastor(user)) return user.role === 'PASTOR' ? this.prisma.user.findMany({ where: { id: user.id }, select: pastorSelect }) : [];
    return this.prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['PASTOR', 'SUPER_ADMIN'] } }, select: pastorSelect, orderBy: { fullName: 'asc' } });
  }

  /** Users who can be made shepherds of a group. */
  async shepherdCandidates(user: AuthUser): Promise<PastorDto[]> {
    if (!this.policy.canCreateGroup(user)) return [];
    return this.prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['SHEPHERD', 'PASTOR'] } }, select: pastorSelect, orderBy: { fullName: 'asc' } });
  }

  private async resolvePastor(user: AuthUser, pastorId: string | null | undefined): Promise<string | null | undefined> {
    if (pastorId === undefined) return undefined;
    if (!this.policy.canAssignPastor(user)) {
      if (pastorId !== null && pastorId !== user.id) throw forbidden('Only a Super Admin can choose another pastor');
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
      const parent = await this.prisma.churchGroup.findUnique({ where: { id: dto.parentId }, select: { type: true, pastorId: true } });
      if (parent?.type !== 'CONSTITUENCY') throw badRequest('PARENT_INVALID', 'Choose a valid constituency');
      if (!this.policy.canCreateGroupOfType(user, 'BASONTA', parent)) throw forbidden('Only the constituency’s head pastor or a Super Admin can add basontas to it');
      parentId = dto.parentId;
    } else if (!this.policy.canCreateGroupOfType(user, dto.type)) {
      throw forbidden(dto.type === 'CONSTITUENCY' ? 'Only a Super Admin can create constituencies' : 'Only pastors and Super Admins can create bacentas');
    }
    if (!this.policy.canAssignPastor(user) && dto.pastorId && dto.pastorId !== user.id) throw forbidden('Only a Super Admin can choose another pastor');
    // A pastor creating a bacenta leads it; a head pastor creating a basonta may leave it to
    // be led by someone else later; admins may pick anyone (default: none).
    const pastorId = this.policy.canAssignPastor(user) ? await this.resolvePastor(user, dto.pastorId ?? null) : dto.type === 'BASONTA' ? (dto.pastorId === user.id ? user.id : null) : user.id;
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
      await this.audit.record({ actorId: user.id, action: 'GROUP_CREATED', entityType: 'GROUP', entityId: g.id, metadata: { type: g.type, name: g.name }, meta });
      return this.getGroup(user, g.id);
    } catch (e) {
      if (isUnique(e)) throw conflict('GROUP_EXISTS', `A ${dto.type.toLowerCase()} called “${dto.name.trim()}” already exists`);
      throw e;
    }
  }

  private async loadGroup(id: string) {
    const g = await this.prisma.churchGroup.findUnique({ where: { id }, include: { shepherds: { select: { userId: true } }, parent: { select: { id: true, pastorId: true } } } });
    if (!g) throw notFound('Group');
    return g;
  }

  private async loadAdministeredGroup(user: AuthUser, id: string) {
    const g = await this.loadGroup(id);
    if (!this.policy.canAdministerGroup(user, ref(g))) throw forbidden('Only this group’s pastor or a Super Admin can do that');
    return g;
  }

  async updateGroup(user: AuthUser, id: string, dto: GroupInput, meta: ReqMeta): Promise<GroupDto> {
    const before = await this.loadAdministeredGroup(user, id);
    const pastorId = await this.resolvePastor(user, dto.pastorId);
    if (dto.leadMemberId) {
      if (before.type !== 'BACENTA') throw badRequest('INVALID', 'Only bacentas have a team lead');
      const inIt = await this.prisma.memberBacenta.findUnique({ where: { memberId_groupId: { memberId: dto.leadMemberId, groupId: id } } });
      if (!inIt) throw badRequest('LEAD_INVALID', 'The team lead must be a member of this bacenta');
    }
    let parentId: string | undefined;
    if (dto.parentId !== undefined && before.type === 'BASONTA' && dto.parentId && dto.parentId !== before.parentId) {
      const parent = await this.prisma.churchGroup.findUnique({ where: { id: dto.parentId }, select: { type: true, pastorId: true } });
      if (parent?.type !== 'CONSTITUENCY') throw badRequest('PARENT_INVALID', 'Choose a valid constituency');
      if (!this.policy.canCreateGroupOfType(user, 'BASONTA', parent)) throw forbidden('You can only move a basonta into a constituency you lead');
      parentId = dto.parentId;
    }
    try {
      await this.prisma.churchGroup.update({
        where: { id },
        data: { name: dto.name?.trim() || undefined, description: blank(dto.description), meetingDay: blank(dto.meetingDay), meetingPlace: blank(dto.meetingPlace), isActive: dto.isActive, pastorId, parentId, leadMemberId: dto.leadMemberId },
      });
      // Members of a basonta that moved follow it to its new constituency.
      if (parentId) await this.prisma.member.updateMany({ where: { basontaId: id }, data: { constituencyId: parentId } });
    } catch (e) {
      if (isUnique(e)) throw conflict('GROUP_EXISTS', 'Another group already has that name');
      throw e;
    }
    await this.audit.record({ actorId: user.id, action: 'GROUP_UPDATED', entityType: 'GROUP', entityId: id, metadata: { before: { name: before.name, pastorId: before.pastorId }, after: { ...dto } }, meta });
    return this.getGroup(user, id);
  }

  async deleteGroup(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const g = await this.loadAdministeredGroup(user, id);
    await this.prisma.churchGroup.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'GROUP_DELETED', entityType: 'GROUP', entityId: id, metadata: { type: g.type, name: g.name }, meta });
  }

  async addShepherd(user: AuthUser, groupId: string, userId: string, meta: ReqMeta): Promise<GroupDto> {
    await this.loadAdministeredGroup(user, groupId);
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, role: true, fullName: true } });
    if (!u || u.status !== 'ACTIVE' || (u.role !== 'SHEPHERD' && u.role !== 'PASTOR')) throw badRequest('SHEPHERD_INVALID', 'Choose an active user with the Shepherd or Pastor role');
    await this.prisma.groupShepherd.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
    await this.audit.record({ actorId: user.id, action: 'GROUP_SHEPHERD_ADDED', entityType: 'GROUP', entityId: groupId, metadata: { userId, fullName: u.fullName }, meta });
    return this.getGroup(user, groupId);
  }

  async removeShepherd(user: AuthUser, groupId: string, userId: string, meta: ReqMeta): Promise<GroupDto> {
    await this.loadAdministeredGroup(user, groupId);
    await this.prisma.groupShepherd.deleteMany({ where: { groupId, userId } });
    await this.audit.record({ actorId: user.id, action: 'GROUP_SHEPHERD_REMOVED', entityType: 'GROUP', entityId: groupId, metadata: { userId }, meta });
    return this.getGroup(user, groupId);
  }

  /** Charts for one group: shown to its pastor, shepherds and admins. */
  async groupStats(user: AuthUser, id: string, q: { from?: string; to?: string }): Promise<GroupStatsDto> {
    const g = await this.loadGroup(id);
    if (!this.policy.canManageGroup(user, ref(g)) && !this.policy.canViewChurchStats(user)) throw forbidden('Only this group’s leaders can see its statistics');
    const { from, to, f, t } = range(q, 90);
    const memberWhere: Prisma.MemberWhereInput = { ...memberWhereFor(g), isActive: true };
    const [members, sessions, roles, guests, church, teamRoles, noRole] = await Promise.all([
      this.prisma.member.count({ where: memberWhere }),
      this.prisma.attendanceSession.findMany({
        where: { groupId: id, date: { gte: f, lte: t } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, date: true, serviceType: true, title: true, visitorCount: true, _count: { select: { records: true, guests: true } } },
      }),
      this.prisma.member.groupBy({ by: ['churchRole'], where: memberWhere, _count: { _all: true }, orderBy: { _count: { churchRole: 'desc' } } }),
      this.prisma.guest.groupBy({
        by: ['intent'],
        where: { session: { date: { gte: f, lte: t } }, broughtBy: memberWhere },
        _count: { _all: true, convertedMemberId: true },
      }),
      this.prisma.$queryRaw<Array<{ sessions: number; present: number }>>`
        SELECT count(DISTINCT s.id)::int AS sessions, count(r."memberId")::int AS present
        FROM "AttendanceSession" s
        LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id AND r."memberId" IN (
          SELECT m.id FROM "Member" m WHERE m."isActive" AND (
            ${g.type === 'CONSTITUENCY'} AND m."constituencyId" = ${id}::uuid
            OR ${g.type === 'BASONTA'} AND m."basontaId" = ${id}::uuid
            OR ${g.type === 'BACENTA'} AND EXISTS (SELECT 1 FROM "MemberBacenta" b WHERE b."memberId" = m.id AND b."groupId" = ${id}::uuid)))
        WHERE s."kind" = 'CHURCH_SERVICE' AND s."date" BETWEEN ${f}::date AND ${t}::date`,
      g.type === 'BACENTA'
        ? this.prisma.bacentaRole.findMany({
            where: { groupId: id },
            select: { id: true, name: true, _count: { select: { members: { where: { membership: { member: { isActive: true } } } } } } },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          })
        : Promise.resolve([]),
      g.type === 'BACENTA' ? this.prisma.memberBacenta.count({ where: { groupId: id, member: { isActive: true }, roles: { none: {} } } }) : Promise.resolve(0),
    ]);
    const meetings = sessions.map((s) => ({
      id: s.id,
      date: fromDateOnly(s.date)!,
      serviceType: s.serviceType,
      title: s.title,
      present: s._count.records,
      visitors: s.visitorCount,
      guests: s._count.guests,
    }));
    const last = meetings[meetings.length - 1];
    const gi = (k: GuestIntent) => guests.find((x) => x.intent === k);
    const c = church[0] ?? { sessions: 0, present: 0 };
    return {
      from,
      to,
      members,
      meetings,
      averagePresent: meetings.length ? Math.round((meetings.reduce((a, m) => a + m.present, 0) / meetings.length) * 10) / 10 : 0,
      lastMeeting: last ? { id: last.id, date: last.date, present: last.present, absent: Math.max(0, members - last.present) } : null,
      roles: roles.map((r) => ({ role: r.churchRole, count: r._count._all })),
      teamRoles: [
        ...teamRoles.map((r) => ({ id: r.id, name: r.name, count: r._count.members })),
        ...(g.type === 'BACENTA' && noRole ? [{ id: null, name: 'No role yet', count: noRole }] : []),
      ],
      guests: {
        visit: gi('VISIT')?._count._all ?? 0,
        joining: gi('JOINING')?._count._all ?? 0,
        converted: (gi('VISIT')?._count.convertedMemberId ?? 0) + (gi('JOINING')?._count.convertedMemberId ?? 0),
      },
      churchServices: { sessions: c.sessions, averagePresent: c.sessions ? Math.round((c.present / c.sessions) * 10) / 10 : 0 },
    };
  }

  /** Super Admin: every pastor and shepherd, with the groups they lead or shepherd. */
  async leaders(user: AuthUser): Promise<LeaderDto[]> {
    if (!this.policy.canViewLeaders(user)) throw forbidden();
    const rows = await this.prisma.user.findMany({
      where: { OR: [{ role: { in: ['PASTOR', 'SHEPHERD'] } }, { pastoredGroups: { some: {} } }] },
      select: {
        ...pastorSelect,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        pastoredGroups: { select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } },
        shepherding: { select: { group: { select: { id: true, name: true, type: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((u) => ({
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
      shepherds: u.shepherding.map((s) => s.group).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  // ---------------------------------------------------------------- bacenta team roles

  private async loadBacenta(user: AuthUser, id: string, administer = false) {
    const g = await this.loadGroup(id);
    if (g.type !== 'BACENTA') throw badRequest('INVALID', 'Team roles are for bacentas');
    const r = ref(g);
    if (!(administer ? this.policy.canAdministerGroup(user, r) : this.policy.canManageGroup(user, r))) throw forbidden('Only this bacenta’s leaders or a Super Admin can do that');
    return g;
  }

  private async checkLead(groupId: string, leadId: string | null | undefined) {
    if (!leadId) return;
    const inIt = await this.prisma.memberBacenta.findUnique({ where: { memberId_groupId: { memberId: leadId, groupId } } });
    if (!inIt) throw badRequest('LEAD_INVALID', 'The team lead must be a member of this bacenta');
  }

  async createRole(user: AuthUser, groupId: string, dto: { name: string; leadId?: string | null }, meta: ReqMeta): Promise<GroupDto> {
    await this.loadBacenta(user, groupId);
    await this.checkLead(groupId, dto.leadId);
    const last = await this.prisma.bacentaRole.aggregate({ where: { groupId }, _max: { sortOrder: true } });
    try {
      await this.prisma.bacentaRole.create({ data: { groupId, name: dto.name.trim(), leadId: dto.leadId ?? null, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    } catch (e) {
      if (isUnique(e)) throw conflict('ROLE_EXISTS', `There is already a “${dto.name.trim()}” team`);
      throw e;
    }
    await this.audit.record({ actorId: user.id, action: 'TEAM_ROLE_CREATED', entityType: 'GROUP', entityId: groupId, metadata: { name: dto.name.trim() }, meta });
    return this.getGroup(user, groupId);
  }

  async updateRole(user: AuthUser, groupId: string, roleId: string, dto: { name?: string; leadId?: string | null }, meta: ReqMeta): Promise<GroupDto> {
    await this.loadBacenta(user, groupId);
    await this.checkLead(groupId, dto.leadId);
    const r = await this.prisma.bacentaRole.findUnique({ where: { id: roleId } });
    if (!r || r.groupId !== groupId) throw notFound('Team role');
    try {
      await this.prisma.bacentaRole.update({ where: { id: roleId }, data: { name: dto.name?.trim() || undefined, leadId: dto.leadId } });
    } catch (e) {
      if (isUnique(e)) throw conflict('ROLE_EXISTS', 'Another team already has that name');
      throw e;
    }
    await this.audit.record({ actorId: user.id, action: 'TEAM_ROLE_UPDATED', entityType: 'GROUP', entityId: groupId, metadata: { roleId, ...dto }, meta });
    return this.getGroup(user, groupId);
  }

  async deleteRole(user: AuthUser, groupId: string, roleId: string, meta: ReqMeta): Promise<GroupDto> {
    await this.loadBacenta(user, groupId);
    const r = await this.prisma.bacentaRole.findUnique({ where: { id: roleId } });
    if (!r || r.groupId !== groupId) throw notFound('Team role');
    await this.prisma.bacentaRole.delete({ where: { id: roleId } });
    await this.audit.record({ actorId: user.id, action: 'TEAM_ROLE_DELETED', entityType: 'GROUP', entityId: groupId, metadata: { name: r.name }, meta });
    return this.getGroup(user, groupId);
  }

  // ---------------------------------------------------------------- group membership (existing members)

  /**
   * Puts an existing member into a group. Bacenta: adds them (with team roles).
   * Basonta: makes it their basonta (and its constituency theirs). Constituency: makes it
   * theirs (dropping a basonta from another constituency).
   */
  async addToGroup(user: AuthUser, groupId: string, memberId: string, roleIds: string[] | undefined, meta: ReqMeta) {
    const g = await this.loadGroup(groupId);
    if (!this.policy.canManageGroup(user, ref(g))) throw forbidden('Only this group’s leaders or a Super Admin can add members to it');
    const m = await this.prisma.member.findUnique({ where: { id: memberId }, select: { id: true, fullName: true, constituencyId: true, basontaId: true } });
    if (!m) throw notFound('Member');
    if (g.type === 'BACENTA') {
      if (roleIds?.length) {
        const n = await this.prisma.bacentaRole.count({ where: { id: { in: roleIds }, groupId } });
        if (n !== new Set(roleIds).size) throw badRequest('ROLE_INVALID', 'A team role doesn’t belong to this bacenta');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.memberBacenta.upsert({ where: { memberId_groupId: { memberId, groupId } }, create: { memberId, groupId }, update: {} });
        if (roleIds) {
          await tx.memberBacentaRole.deleteMany({ where: { memberId, groupId } });
          if (roleIds.length) await tx.memberBacentaRole.createMany({ data: [...new Set(roleIds)].map((roleId) => ({ memberId, groupId, roleId })) });
        }
      });
    } else if (g.type === 'BASONTA') {
      await this.prisma.member.update({ where: { id: memberId }, data: { basontaId: groupId, ...(g.parentId ? { constituencyId: g.parentId } : {}) } });
    } else {
      const keepBasonta = m.basontaId ? (await this.prisma.churchGroup.findUnique({ where: { id: m.basontaId }, select: { parentId: true } }))?.parentId === groupId : false;
      await this.prisma.member.update({ where: { id: memberId }, data: { constituencyId: groupId, ...(keepBasonta ? {} : { basontaId: null }) } });
    }
    await this.audit.record({ actorId: user.id, action: 'GROUP_MEMBER_ADDED', entityType: 'GROUP', entityId: groupId, metadata: { member: m.fullName, roleIds: roleIds ?? null }, meta });
    return this.getMember(user, memberId);
  }

  async removeFromGroup(user: AuthUser, groupId: string, memberId: string, meta: ReqMeta) {
    const g = await this.loadGroup(groupId);
    if (!this.policy.canManageGroup(user, ref(g))) throw forbidden();
    const m = await this.prisma.member.findUnique({ where: { id: memberId }, select: { fullName: true } });
    if (!m) throw notFound('Member');
    if (g.type === 'BACENTA') {
      await this.prisma.$transaction([
        this.prisma.memberBacenta.deleteMany({ where: { memberId, groupId } }),
        this.prisma.bacentaRole.updateMany({ where: { groupId, leadId: memberId }, data: { leadId: null } }),
        this.prisma.churchGroup.updateMany({ where: { id: groupId, leadMemberId: memberId }, data: { leadMemberId: null } }),
      ]);
    } else if (g.type === 'BASONTA') await this.prisma.member.updateMany({ where: { id: memberId, basontaId: groupId }, data: { basontaId: null } });
    else await this.prisma.member.updateMany({ where: { id: memberId, constituencyId: groupId }, data: { constituencyId: null, basontaId: null } });
    await this.audit.record({ actorId: user.id, action: 'GROUP_MEMBER_REMOVED', entityType: 'GROUP', entityId: groupId, metadata: { member: m.fullName }, meta });
  }

  /** Sets a member's team roles in a bacenta. */
  async setMemberRoles(user: AuthUser, groupId: string, memberId: string, roleIds: string[], meta: ReqMeta) {
    return this.addToGroup(user, groupId, memberId, roleIds, meta);
  }

  // ---------------------------------------------------------------- members

  private async lastSeen(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ memberId: string; last: Date }>>`
      SELECT r."memberId", max(s."date") AS last
      FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
      WHERE r."memberId" = ANY(${ids}::uuid[])
      GROUP BY r."memberId"`;
    return new Map(rows.map((r) => [r.memberId, fromDateOnly(r.last)!]));
  }

  private memberGroups(m: MemberRow): GroupRef[] {
    return [...(m.constituency ? [m.constituency] : []), ...(m.basonta ? [m.basonta] : []), ...m.bacentas.map((b) => b.group)].map(ref);
  }

  private toMemberDto(user: AuthUser, m: MemberRow, lastSeen: string | null): MemberDto {
    return {
      id: m.id,
      fullName: m.fullName,
      phone: m.phone,
      email: m.email,
      gender: m.gender,
      dateOfBirth: fromDateOnly(m.dateOfBirth),
      location: m.location,
      churchRole: m.churchRole,
      joinedOn: fromDateOnly(m.joinedOn),
      isActive: m.isActive,
      notes: m.notes,
      constituency: m.constituency ? { id: m.constituency.id, name: m.constituency.name } : null,
      basonta: m.basonta ? { id: m.basonta.id, name: m.basonta.name } : null,
      bacentas: m.bacentas
        .map((b) => ({ id: b.group.id, name: b.group.name, roles: b.roles.map((r) => r.role).sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name)).map(({ id, name }) => ({ id, name })) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      lastSeen,
      canEdit: this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) }),
    };
  }

  async listMembers(
    user: AuthUser,
    q: { q?: string; constituencyId?: string; basontaId?: string; bacentaId?: string; teamRoleId?: string; churchRole?: string; status?: 'active' | 'inactive' | 'all'; page?: number; limit?: number },
  ): Promise<{ items: MemberDto[]; total: number; page: number; pageSize: number }> {
    this.assertView(user);
    const pageSize = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    const term = q.q?.trim();
    const where: Prisma.MemberWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.constituencyId === 'none' ? { constituencyId: null } : q.constituencyId ? { constituencyId: q.constituencyId } : {}),
      ...(q.basontaId === 'none' ? { basontaId: null } : q.basontaId ? { basontaId: q.basontaId } : {}),
      ...(q.bacentaId ? { bacentas: { some: { groupId: q.bacentaId, ...(q.teamRoleId ? { roles: { some: { roleId: q.teamRoleId } } } : {}) } } } : {}),
      ...(q.churchRole ? { churchRole: { equals: q.churchRole, mode: 'insensitive' } } : {}),
      ...(term
        ? {
            OR: [
              { fullName: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term.replace(/\s+/g, '') } },
              { location: { contains: term, mode: 'insensitive' } },
              { churchRole: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.member.count({ where }),
      this.prisma.member.findMany({ where, include: memberInclude, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const seen = await this.lastSeen(rows.map((r) => r.id));
    return { items: rows.map((m) => this.toMemberDto(user, m, seen.get(m.id) ?? null)), total, page, pageSize };
  }

  async getMember(user: AuthUser, id: string) {
    this.assertView(user);
    const m = await this.prisma.member.findUnique({ where: { id }, include: { ...memberInclude, convertedFrom: { include: { broughtBy: { select: { id: true, fullName: true } } } } } });
    if (!m) throw notFound('Member');
    const [history, brought] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { memberId: id },
        include: { session: { select: { id: true, kind: true, serviceType: true, title: true, date: true, group: { select: { id: true, name: true } } } } },
        orderBy: { session: { date: 'desc' } },
        take: 30,
      }),
      this.prisma.guest.findMany({
        where: { broughtById: id },
        include: { convertedMember: { select: { id: true, fullName: true } }, session: { select: { id: true, date: true, serviceType: true, title: true, group: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const seen = await this.lastSeen([id]);
    return {
      ...this.toMemberDto(user, m, seen.get(id) ?? null),
      broughtBy: m.convertedFrom?.broughtBy ?? null,
      history: history.map((h) => ({
        sessionId: h.session.id,
        kind: h.session.kind,
        serviceType: h.session.serviceType,
        title: h.session.title,
        date: fromDateOnly(h.session.date)!,
        group: h.session.group,
        broughtCount: h.broughtCount,
      })),
      brought: brought.map((b) => this.guestDto(b)),
    };
  }

  /** Checks group ids and returns the constituency implied by the basonta (if any). */
  private async validateGroups(dto: MemberInput): Promise<string | null | undefined> {
    let constituencyId = dto.constituencyId;
    if (dto.basontaId) {
      const b = await this.prisma.churchGroup.findUnique({ where: { id: dto.basontaId }, select: { type: true, parentId: true } });
      if (b?.type !== 'BASONTA') throw badRequest('BASONTA_INVALID', 'Choose a valid basonta');
      if (b.parentId) {
        if (constituencyId && constituencyId !== b.parentId) throw badRequest('BASONTA_MISMATCH', 'That basonta is in a different constituency');
        constituencyId = b.parentId;
      }
    }
    if (constituencyId) {
      const c = await this.prisma.churchGroup.findUnique({ where: { id: constituencyId }, select: { type: true } });
      if (c?.type !== 'CONSTITUENCY') throw badRequest('CONSTITUENCY_INVALID', 'Choose a valid constituency');
    }
    if (dto.bacentas?.length) {
      const ids = [...new Set(dto.bacentas.map((b) => b.groupId))];
      const n = await this.prisma.churchGroup.count({ where: { id: { in: ids }, type: 'BACENTA' } });
      if (n !== ids.length) throw badRequest('BACENTA_INVALID', 'Choose valid bacentas');
      const roleIds = dto.bacentas.flatMap((b) => (b.roleIds ?? []).map((r) => ({ r, g: b.groupId })));
      if (roleIds.length) {
        const roles = await this.prisma.bacentaRole.findMany({ where: { id: { in: roleIds.map((x) => x.r) } }, select: { id: true, groupId: true } });
        const by = new Map(roles.map((r) => [r.id, r.groupId]));
        if (roleIds.some((x) => by.get(x.r) !== x.g)) throw badRequest('ROLE_INVALID', 'A team role doesn’t belong to that bacenta');
      }
    }
    return constituencyId;
  }

  private async writeBacentas(tx: Prisma.TransactionClient, memberId: string, bacentas: Array<{ groupId: string; roleIds?: string[] }>) {
    await tx.memberBacenta.deleteMany({ where: { memberId } });
    const uniq = [...new Map(bacentas.map((b) => [b.groupId, b])).values()];
    if (!uniq.length) return;
    await tx.memberBacenta.createMany({ data: uniq.map((b) => ({ memberId, groupId: b.groupId })) });
    const roles = uniq.flatMap((b) => [...new Set(b.roleIds ?? [])].map((roleId) => ({ memberId, groupId: b.groupId, roleId })));
    if (roles.length) await tx.memberBacentaRole.createMany({ data: roles });
  }

  private memberData(dto: MemberInput) {
    return {
      fullName: dto.fullName?.trim() || undefined,
      phone: blank(dto.phone)?.replace(/\s+/g, '') ?? (dto.phone === undefined ? undefined : null),
      email: blank(dto.email)?.toLowerCase() ?? (dto.email === undefined ? undefined : null),
      gender: blank(dto.gender),
      dateOfBirth: dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
      location: blank(dto.location),
      churchRole: dto.churchRole?.trim() || undefined,
      constituencyId: dto.constituencyId === undefined ? undefined : dto.constituencyId || null,
      basontaId: dto.basontaId === undefined ? undefined : dto.basontaId || null,
      joinedOn: dto.joinedOn === undefined ? undefined : dto.joinedOn ? toDateOnly(dto.joinedOn) : null,
      isActive: dto.isActive,
      notes: blank(dto.notes),
    };
  }

  async createMember(user: AuthUser, dto: MemberInput, meta: ReqMeta) {
    if (!this.policy.canAddMembers(user)) throw forbidden('Only leaders and Super Admins can add members');
    if (!dto.fullName?.trim()) throw badRequest('INVALID', 'Full name is required');
    const constituencyId = await this.validateGroups(dto);
    const data = { ...this.memberData(dto), constituencyId: constituencyId ?? null };
    if (data.phone) {
      const dup = await this.prisma.member.findFirst({ where: { phone: data.phone }, select: { fullName: true } });
      if (dup) throw conflict('MEMBER_EXISTS', `${dup.fullName} already has the phone number ${data.phone}`);
    }
    if (dto.fromGuestId) {
      const g = await this.prisma.guest.findUnique({ where: { id: dto.fromGuestId }, select: { convertedMemberId: true } });
      if (!g) throw notFound('Guest');
      if (g.convertedMemberId) throw conflict('GUEST_CONVERTED', 'This guest is already a member');
    }
    const m = await this.prisma.$transaction(async (tx) => {
      const created = await tx.member.create({
        data: {
          ...data,
          fullName: data.fullName!,
          joinedOn: data.joinedOn ?? (dto.fromGuestId ? toDateOnly(today()) : null),
          createdById: user.id,
        },
      });
      if (dto.bacentas?.length) await this.writeBacentas(tx, created.id, dto.bacentas);
      if (dto.fromGuestId) await tx.guest.update({ where: { id: dto.fromGuestId }, data: { convertedMemberId: created.id, intent: 'JOINING' } });
      return created;
    });
    await this.audit.record({ actorId: user.id, action: dto.fromGuestId ? 'GUEST_CONVERTED' : 'MEMBER_CREATED', entityType: 'MEMBER', entityId: m.id, metadata: { fullName: m.fullName, guestId: dto.fromGuestId ?? null }, meta });
    return this.getMember(user, m.id);
  }

  private async loadEditableMember(user: AuthUser, id: string) {
    const m = await this.prisma.member.findUnique({ where: { id }, include: memberInclude });
    if (!m) throw notFound('Member');
    if (!this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) }))
      throw forbidden('Only the leaders of this member’s groups or a Super Admin can change this member');
    return m;
  }

  async updateMember(user: AuthUser, id: string, dto: MemberInput, meta: ReqMeta) {
    const before = await this.loadEditableMember(user, id);
    const constituencyId = await this.validateGroups({ ...dto, basontaId: dto.basontaId === undefined ? undefined : dto.basontaId });
    const data = { ...this.memberData(dto), ...(constituencyId !== undefined ? { constituencyId } : {}) };
    // Changing constituency without choosing a basonta drops a basonta that no longer fits.
    if (dto.constituencyId !== undefined && dto.basontaId === undefined && before.basontaId && dto.constituencyId !== before.constituencyId) data.basontaId = null;
    if (data.phone) {
      const dup = await this.prisma.member.findFirst({ where: { phone: data.phone, id: { not: id } }, select: { fullName: true } });
      if (dup) throw conflict('MEMBER_EXISTS', `${dup.fullName} already has the phone number ${data.phone}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id }, data });
      if (dto.bacentas) await this.writeBacentas(tx, id, dto.bacentas);
    });
    await this.audit.record({ actorId: user.id, action: 'MEMBER_UPDATED', entityType: 'MEMBER', entityId: id, metadata: { fields: Object.keys(dto) }, meta });
    return this.getMember(user, id);
  }

  /**
   * Moves a member from one group to another of the same type (choir → media, or one
   * constituency to another). Allowed for leaders of the group they leave, or admins.
   */
  async moveMember(user: AuthUser, id: string, fromGroupId: string, toGroupId: string, meta: ReqMeta) {
    if (fromGroupId === toGroupId) throw badRequest('INVALID', 'Choose a different group');
    const m = await this.prisma.member.findUnique({ where: { id }, include: memberInclude });
    if (!m) throw notFound('Member');
    const [from, to] = await Promise.all([this.loadGroup(fromGroupId), this.loadGroup(toGroupId)]);
    if (from.type !== to.type) throw badRequest('INVALID', 'Members can only move between groups of the same kind');
    if (!this.policy.canManageGroup(user, ref(from)) && !this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) }))
      throw forbidden('Only the leaders of this member’s group or a Super Admin can move them');
    if (from.type === 'CONSTITUENCY') {
      if (m.constituencyId !== fromGroupId) throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      // Their basonta belonged to the old constituency, so it no longer applies.
      await this.prisma.member.update({ where: { id }, data: { constituencyId: toGroupId, basontaId: null } });
    } else if (from.type === 'BASONTA') {
      if (m.basontaId !== fromGroupId) throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      await this.prisma.member.update({ where: { id }, data: { basontaId: toGroupId, ...(to.parentId ? { constituencyId: to.parentId } : {}) } });
    } else {
      if (!m.bacentas.some((b) => b.groupId === fromGroupId)) throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      // Team roles belong to a bacenta, so they don't carry over.
      await this.prisma.$transaction([
        this.prisma.memberBacenta.delete({ where: { memberId_groupId: { memberId: id, groupId: fromGroupId } } }),
        // They no longer lead anything in the bacenta they left.
        this.prisma.bacentaRole.updateMany({ where: { groupId: fromGroupId, leadId: id }, data: { leadId: null } }),
        this.prisma.churchGroup.updateMany({ where: { id: fromGroupId, leadMemberId: id }, data: { leadMemberId: null } }),
        this.prisma.memberBacenta.upsert({ where: { memberId_groupId: { memberId: id, groupId: toGroupId } }, create: { memberId: id, groupId: toGroupId }, update: {} }),
      ]);
    }
    await this.audit.record({ actorId: user.id, action: 'MEMBER_MOVED', entityType: 'MEMBER', entityId: id, metadata: { from: from.name, to: to.name }, meta });
    return this.getMember(user, id);
  }

  async deleteMember(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const m = await this.loadEditableMember(user, id);
    await this.prisma.member.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'MEMBER_DELETED', entityType: 'MEMBER', entityId: id, metadata: { fullName: m.fullName }, meta });
  }

  // ---------------------------------------------------------------- attendance

  private checkDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw badRequest('INVALID_DATE', 'Choose a valid date');
    if (date > today()) throw badRequest('FUTURE_DATE', 'Attendance can’t be recorded for a future date');
  }

  private async sessionContext(user: AuthUser, id: string) {
    const s = await this.prisma.attendanceSession.findUnique({
      where: { id },
      include: { group: { include: { shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } } }, recordedBy: { select: { fullName: true } } },
    });
    if (!s) throw notFound('Attendance');
    const canEdit = s.group ? this.policy.canManageGroup(user, ref(s.group)) : this.policy.canRecordSunday(user);
    const where: Prisma.MemberWhereInput = s.group ? memberWhereFor(s.group) : {};
    return { s, canEdit, where };
  }

  private sessionInfo(s: Awaited<ReturnType<MembershipService['sessionContext']>>['s']): SessionInfoDto {
    return {
      id: s.id,
      kind: s.kind,
      serviceType: s.serviceType,
      title: s.title,
      date: fromDateOnly(s.date)!,
      group: s.group ? { id: s.group.id, name: s.group.name, type: s.group.type } : null,
      visitorCount: s.visitorCount,
      firstTimerCount: s.firstTimerCount,
      notes: s.notes,
      recordedBy: s.recordedBy?.fullName ?? null,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private guestDto(g: Prisma.GuestGetPayload<{ include: { convertedMember: { select: { id: true; fullName: true } } } }> & {
    broughtBy?: { id: string; fullName: string } | null;
    session?: { id: string; date: Date; serviceType: string; title: string | null; group: { id: string; name: string } | null };
  }): GuestDto {
    return {
      id: g.id,
      fullName: g.fullName,
      phone: g.phone,
      intent: g.intent,
      broughtBy: g.broughtBy ?? null,
      convertedMember: g.convertedMember,
      ...(g.session
        ? { session: { id: g.session.id, date: fromDateOnly(g.session.date)!, serviceType: g.session.serviceType, title: g.session.title, group: g.session.group } }
        : {}),
    };
  }

  /** Creates (or opens the existing) session for a service/meeting on a date. */
  async createSession(user: AuthUser, dto: SessionInput, meta: ReqMeta): Promise<{ id: string; created: boolean }> {
    this.checkDate(dto.date);
    const serviceType = dto.serviceType.trim();
    if (!serviceType) throw badRequest('INVALID', 'Say what kind of service or meeting this is');
    let group: Awaited<ReturnType<MembershipService['loadGroup']>> | null = null;
    if (dto.groupId) {
      group = await this.loadGroup(dto.groupId);
      if (!this.policy.canManageGroup(user, ref(group))) throw forbidden('Only this group’s leaders or a Super Admin can take its attendance');
    } else if (!this.policy.canRecordSunday(user)) throw forbidden('Only pastors and Super Admins can record church services');
    const title = blank(dto.title) ?? null;
    const date = toDateOnly(dto.date);
    const kind: AttendanceKind = group ? 'GROUP_MEETING' : 'CHURCH_SERVICE';
    const existing = await this.prisma.attendanceSession.findFirst({
      where: { kind, groupId: group?.id ?? null, date, serviceType: { equals: serviceType, mode: 'insensitive' }, title: title ? { equals: title, mode: 'insensitive' } : null },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    try {
      const s = await this.prisma.attendanceSession.create({ data: { kind, groupId: group?.id ?? null, date, serviceType, title, recordedById: user.id } });
      await this.audit.record({ actorId: user.id, action: 'ATTENDANCE_CREATED', entityType: 'ATTENDANCE', entityId: s.id, metadata: { serviceType, title, date: dto.date, group: group?.name ?? null }, meta });
      return { id: s.id, created: true };
    } catch (e) {
      if (isUnique(e)) {
        const again = await this.prisma.attendanceSession.findFirst({ where: { kind, groupId: group?.id ?? null, date, serviceType: { equals: serviceType, mode: 'insensitive' } }, select: { id: true } });
        if (again) return { id: again.id, created: false };
      }
      throw e;
    }
  }

  async getSheet(user: AuthUser, id: string): Promise<AttendanceSheetDto> {
    this.assertView(user);
    const { s, canEdit, where } = await this.sessionContext(user, id);
    const [records, guests] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { sessionId: id }, select: { memberId: true, broughtCount: true } }),
      this.prisma.guest.findMany({ where: { sessionId: id }, include: { broughtBy: { select: { id: true, fullName: true } }, convertedMember: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const presentIds = records.map((r) => r.memberId);
    const roster = await this.prisma.member.findMany({
      where: { OR: [{ ...where, isActive: true }, ...(presentIds.length ? [{ id: { in: presentIds } }] : [])] },
      select: {
        id: true,
        fullName: true,
        churchRole: true,
        constituency: { select: { id: true, name: true } },
        // Team roles only exist in bacentas; for other sessions this matches nothing.
        bacentas: { where: { groupId: s.group?.type === 'BACENTA' ? s.group.id : NIL_UUID }, select: { roles: { select: { role: { select: { id: true, name: true } } } } } },
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
      brought: Object.fromEntries(records.filter((r) => r.broughtCount !== null).map((r) => [r.memberId, r.broughtCount!])),
      guests: guests.map((g) => this.guestDto(g)),
      canEdit,
    };
  }

  /**
   * Saves ticks. Only members in `rosterIds` (the ones whose tick changed) are touched,
   * so two people marking different parts of the same service don't overwrite each other.
   */
  async saveSheet(user: AuthUser, id: string, dto: SheetInput, meta: ReqMeta): Promise<AttendanceSheetDto> {
    const { s, canEdit } = await this.sessionContext(user, id);
    if (!canEdit) throw forbidden(s.group ? 'Only this group’s leaders or a Super Admin can take its attendance' : 'Only pastors and Super Admins can record church services');
    if (dto.date) this.checkDate(dto.date);
    const roster = [...new Set(dto.rosterIds)];
    const present = [...new Set(dto.presentIds)].filter((x) => roster.includes(x));
    const existing = new Set((await this.prisma.member.findMany({ where: { id: { in: present } }, select: { id: true } })).map((m) => m.id));
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
        if (add.length) await tx.attendanceRecord.createMany({ data: add.map((memberId) => ({ sessionId: id, memberId })), skipDuplicates: true });
      });
    } catch (e) {
      if (isUnique(e)) throw conflict('SESSION_EXISTS', 'That service is already recorded for that date. Give this one a different title (e.g. “2nd service”).');
      throw e;
    }
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_SAVED',
      entityType: 'ATTENDANCE',
      entityId: id,
      metadata: { serviceType: s.serviceType, date: fromDateOnly(s.date), changed: roster.length, visitors: dto.visitorCount ?? null },
      meta,
    });
    return this.getSheet(user, id);
  }

  /** Records how many people a member brought (0 = nobody) and who they were. Marks the member present. */
  async saveBrought(user: AuthUser, id: string, memberId: string, dto: BroughtInput, meta: ReqMeta): Promise<AttendanceSheetDto> {
    const { s, canEdit } = await this.sessionContext(user, id);
    if (!canEdit) throw forbidden();
    if (dto.guests.length > dto.broughtCount) throw badRequest('INVALID', 'More names than the number brought');
    const member = await this.prisma.member.findUnique({ where: { id: memberId }, select: { fullName: true } });
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
          data: dto.guests.map((g) => ({ sessionId: id, broughtById: memberId, fullName: blank(g.fullName) ?? null, phone: blank(g.phone)?.replace(/\s+/g, '') ?? null, intent: g.intent })),
        });
    });
    await this.audit.record({ actorId: user.id, action: 'ATTENDANCE_BROUGHT', entityType: 'ATTENDANCE', entityId: id, metadata: { member: member.fullName, broughtCount: dto.broughtCount, date: fromDateOnly(s.date) }, meta });
    return this.getSheet(user, id);
  }

  async deleteSession(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const { s, canEdit } = await this.sessionContext(user, id);
    if (!canEdit) throw forbidden();
    await this.prisma.attendanceSession.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'ATTENDANCE_DELETED', entityType: 'ATTENDANCE', entityId: id, metadata: { serviceType: s.serviceType, date: fromDateOnly(s.date), group: s.group?.name ?? null }, meta });
  }

  async listSessions(user: AuthUser, q: { kind?: AttendanceKind; groupId?: string; from?: string; to?: string; mine?: boolean }): Promise<SessionRowDto[]> {
    this.assertView(user);
    const rows = await this.prisma.attendanceSession.findMany({
      where: {
        kind: q.kind,
        groupId: q.groupId,
        date: { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined },
      },
      include: { group: { select: { id: true, name: true, type: true } }, _count: { select: { records: true, guests: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      serviceType: s.serviceType,
      title: s.title,
      date: fromDateOnly(s.date)!,
      group: s.group,
      present: s._count.records,
      visitors: s.visitorCount,
      firstTimers: s.firstTimerCount,
      guests: s._count.guests,
    }));
  }

  /** People brought who want to join and haven't been added as members yet. */
  async pendingGuests(user: AuthUser): Promise<GuestDto[]> {
    if (!this.policy.canAddMembers(user)) throw forbidden();
    const rows = await this.prisma.guest.findMany({
      where: { intent: 'JOINING', convertedMemberId: null },
      include: {
        broughtBy: { select: { id: true, fullName: true } },
        convertedMember: { select: { id: true, fullName: true } },
        session: { select: { id: true, date: true, serviceType: true, title: true, group: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((g) => this.guestDto(g));
  }

  async summary(user: AuthUser, q: { from?: string; to?: string }): Promise<AttendanceSummaryDto> {
    if (!this.policy.canViewChurchStats(user)) throw forbidden('Church-wide reports are for Super Admins. Open one of your groups to see its statistics.');
    const { from, to, f, t } = range(q);

    const [activeMembers, services, byCon, constituencies, basontas, groups, groupStats, absent, guests, brought] = await Promise.all([
      this.prisma.member.count({ where: { isActive: true } }),
      this.prisma.attendanceSession.findMany({
        where: { kind: 'CHURCH_SERVICE', date: { gte: f, lte: t } },
        include: { _count: { select: { records: true, guests: true } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.$queryRaw<Array<{ sessionId: string; constituencyId: string | null; n: number }>>`
        SELECT r."sessionId", m."constituencyId", count(*)::int AS n
        FROM "AttendanceRecord" r
        JOIN "AttendanceSession" s ON s.id = r."sessionId"
        JOIN "Member" m ON m.id = r."memberId"
        WHERE s."kind" = 'CHURCH_SERVICE' AND s."date" BETWEEN ${f}::date AND ${t}::date
        GROUP BY 1, 2`,
      this.prisma.churchGroup.findMany({ where: { type: 'CONSTITUENCY', isActive: true }, select: { id: true, name: true, _count: { select: { members: { where: { isActive: true } } } } }, orderBy: { name: 'asc' } }),
      this.prisma.churchGroup.findMany({ where: { type: { in: ['BASONTA', 'BACENTA'] }, isActive: true }, select: { id: true, name: true, type: true, _count: { select: activeCounts } }, orderBy: { name: 'asc' } }),
      this.prisma.churchGroup.findMany({ where: { isActive: true }, include: groupInclude, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.$queryRaw<Array<{ groupId: string; meetings: number; present: number; last: Date | null }>>`
        SELECT s."groupId", count(DISTINCT s.id)::int AS meetings, count(r."memberId")::int AS present, max(s."date") AS last
        FROM "AttendanceSession" s LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id
        WHERE s."kind" = 'GROUP_MEETING' AND s."date" BETWEEN ${f}::date AND ${t}::date
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ id: string; fullName: string; phone: string | null; constituency: string | null }>>`
        SELECT m.id, m."fullName", m.phone, g.name AS constituency
        FROM "Member" m LEFT JOIN "ChurchGroup" g ON g.id = m."constituencyId"
        WHERE m."isActive" AND (m."joinedOn" IS NULL OR m."joinedOn" <= ${f}::date)
          AND NOT EXISTS (
            SELECT 1 FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
            WHERE r."memberId" = m.id AND s."date" BETWEEN ${f}::date AND ${t}::date)
        ORDER BY g.name NULLS LAST, m."fullName"
        LIMIT 300`,
      this.prisma.guest.groupBy({ by: ['intent'], where: { session: { date: { gte: f, lte: t } } }, _count: { _all: true, convertedMemberId: true } }),
      this.prisma.$queryRaw<Array<{ none: number; some: number }>>`
        SELECT count(*) FILTER (WHERE r."broughtCount" = 0)::int AS none, count(*) FILTER (WHERE r."broughtCount" > 0)::int AS some
        FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
        WHERE s."date" BETWEEN ${f}::date AND ${t}::date`,
    ]);

    const conBySession = new Map<string, Record<string, number>>();
    for (const r of byCon) {
      const m = conBySession.get(r.sessionId) ?? {};
      m[r.constituencyId ?? 'none'] = r.n;
      conBySession.set(r.sessionId, m);
    }
    const types = new Map<string, { sessions: number; present: number }>();
    for (const s of services) {
      const k = s.serviceType;
      const v = types.get(k) ?? { sessions: 0, present: 0 };
      v.sessions++;
      v.present += s._count.records;
      types.set(k, v);
    }
    const stats = new Map(groupStats.map((s) => [s.groupId, s]));
    const seen = await this.lastSeen(absent.map((a) => a.id));
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
        present: s._count.records,
        visitors: s.visitorCount,
        firstTimers: s.firstTimerCount,
        guests: s._count.guests,
        byConstituency: conBySession.get(s.id) ?? {},
      })),
      serviceTypes: [...types.entries()]
        .map(([serviceType, v]) => ({ serviceType, sessions: v.sessions, averagePresent: Math.round((v.present / v.sessions) * 10) / 10 }))
        .sort((a, b) => b.sessions - a.sessions),
      constituencies: constituencies.map((c) => ({ id: c.id, name: c.name, members: c._count.members })),
      basontas: basontas.filter((c) => c.type === 'BASONTA').map((c) => ({ id: c.id, name: c.name, members: c._count.basontaMembers })),
      bacentas: basontas.filter((c) => c.type === 'BACENTA').map((c) => ({ id: c.id, name: c.name, members: c._count.bacentaMembers })),
      groups: groups.map((g) => {
        const s = stats.get(g.id);
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
        converted: (gi('VISIT')?._count.convertedMemberId ?? 0) + (gi('JOINING')?._count.convertedMemberId ?? 0),
        broughtNone: brought[0]?.none ?? 0,
        broughtSome: brought[0]?.some ?? 0,
      },
      absentees: anySession ? absent.map((a) => ({ ...a, lastSeen: seen.get(a.id) ?? null })) : [],
    };
  }
}
