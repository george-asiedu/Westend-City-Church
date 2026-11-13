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
const groupRefSelect = { id: true, name: true, pastorId: true, createdById: true, shepherds: { select: { userId: true } } } as const;
const memberInclude = {
  constituency: { select: groupRefSelect },
  basontas: { include: { group: { select: groupRefSelect } } },
} as const;
type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;
const groupInclude = {
  pastor: { select: pastorSelect },
  shepherds: { select: { user: { select: pastorSelect } }, orderBy: { createdAt: 'asc' } },
  _count: { select: { members: { where: { isActive: true } }, basonta: { where: { member: { isActive: true } } } } },
} as const;
type GroupRow = Prisma.ChurchGroupGetPayload<{ include: typeof groupInclude }>;

/** Policy view of a group row. */
const ref = (g: { pastorId: string | null; createdById: string | null; shepherds: Array<{ userId?: string; user?: { id: string } }> }): GroupRef => ({
  pastorId: g.pastorId,
  createdById: g.createdById,
  shepherdIds: g.shepherds.map((s) => s.userId ?? s.user!.id),
});

export interface GroupInput {
  type?: GroupType;
  name?: string;
  description?: string | null;
  meetingDay?: string | null;
  meetingPlace?: string | null;
  pastorId?: string | null;
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
  basontaIds?: string[];
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
        memberCount: g.type === 'CONSTITUENCY' ? g._count.members : g._count.basonta,
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
    if (!this.policy.canCreateGroup(user)) throw forbidden('Only pastors and Super Admins can create groups');
    if (!dto.type || !dto.name?.trim()) throw badRequest('INVALID', 'Type and name are required');
    if (!this.policy.canAssignPastor(user) && dto.pastorId && dto.pastorId !== user.id) throw forbidden('Only a Super Admin can choose another pastor');
    // A pastor creating a group leads it; admins may pick anyone (default: none).
    const pastorId = this.policy.canAssignPastor(user) ? await this.resolvePastor(user, dto.pastorId ?? null) : user.id;
    try {
      const g = await this.prisma.churchGroup.create({
        data: {
          type: dto.type,
          name: dto.name.trim(),
          description: blank(dto.description) ?? null,
          meetingDay: blank(dto.meetingDay) ?? null,
          meetingPlace: blank(dto.meetingPlace) ?? null,
          pastorId,
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
    const g = await this.prisma.churchGroup.findUnique({ where: { id }, include: { shepherds: { select: { userId: true } } } });
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
    try {
      await this.prisma.churchGroup.update({
        where: { id },
        data: { name: dto.name?.trim() || undefined, description: blank(dto.description), meetingDay: blank(dto.meetingDay), meetingPlace: blank(dto.meetingPlace), isActive: dto.isActive, pastorId },
      });
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
    const memberWhere: Prisma.MemberWhereInput = g.type === 'CONSTITUENCY' ? { constituencyId: id, isActive: true } : { isActive: true, basontas: { some: { groupId: id } } };
    const [members, sessions, roles, guests, church] = await Promise.all([
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
            OR ${g.type === 'BASONTA'} AND EXISTS (SELECT 1 FROM "MemberBasonta" b WHERE b."memberId" = m.id AND b."groupId" = ${id}::uuid)))
        WHERE s."kind" = 'CHURCH_SERVICE' AND s."date" BETWEEN ${f}::date AND ${t}::date`,
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
    return [...(m.constituency ? [m.constituency] : []), ...m.basontas.map((b) => b.group)].map(ref);
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
      basontas: m.basontas.map((b) => ({ id: b.group.id, name: b.group.name })).sort((a, b) => a.name.localeCompare(b.name)),
      lastSeen,
      canEdit: this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) }),
    };
  }

  async listMembers(
    user: AuthUser,
    q: { q?: string; constituencyId?: string; basontaId?: string; churchRole?: string; status?: 'active' | 'inactive' | 'all'; page?: number; limit?: number },
  ): Promise<{ items: MemberDto[]; total: number; page: number; pageSize: number }> {
    this.assertView(user);
    const pageSize = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    const term = q.q?.trim();
    const where: Prisma.MemberWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.constituencyId === 'none' ? { constituencyId: null } : q.constituencyId ? { constituencyId: q.constituencyId } : {}),
      ...(q.basontaId ? { basontas: { some: { groupId: q.basontaId } } } : {}),
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

  private async validateGroups(constituencyId: string | null | undefined, basontaIds: string[] | undefined) {
    if (constituencyId) {
      const c = await this.prisma.churchGroup.findUnique({ where: { id: constituencyId }, select: { type: true } });
      if (c?.type !== 'CONSTITUENCY') throw badRequest('CONSTITUENCY_INVALID', 'Choose a valid constituency');
    }
    if (basontaIds?.length) {
      const n = await this.prisma.churchGroup.count({ where: { id: { in: basontaIds }, type: 'BASONTA' } });
      if (n !== new Set(basontaIds).size) throw badRequest('BASONTA_INVALID', 'Choose valid basontas');
    }
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
      joinedOn: dto.joinedOn === undefined ? undefined : dto.joinedOn ? toDateOnly(dto.joinedOn) : null,
      isActive: dto.isActive,
      notes: blank(dto.notes),
    };
  }

  async createMember(user: AuthUser, dto: MemberInput, meta: ReqMeta) {
    if (!this.policy.canAddMembers(user)) throw forbidden('Only leaders and Super Admins can add members');
    if (!dto.fullName?.trim()) throw badRequest('INVALID', 'Full name is required');
    await this.validateGroups(dto.constituencyId, dto.basontaIds);
    const data = this.memberData(dto);
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
          basontas: dto.basontaIds?.length ? { create: [...new Set(dto.basontaIds)].map((groupId) => ({ groupId })) } : undefined,
        },
      });
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
    await this.loadEditableMember(user, id);
    await this.validateGroups(dto.constituencyId, dto.basontaIds);
    const data = this.memberData(dto);
    if (data.phone) {
      const dup = await this.prisma.member.findFirst({ where: { phone: data.phone, id: { not: id } }, select: { fullName: true } });
      if (dup) throw conflict('MEMBER_EXISTS', `${dup.fullName} already has the phone number ${data.phone}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id }, data });
      if (dto.basontaIds) {
        await tx.memberBasonta.deleteMany({ where: { memberId: id } });
        if (dto.basontaIds.length) await tx.memberBasonta.createMany({ data: [...new Set(dto.basontaIds)].map((groupId) => ({ memberId: id, groupId })) });
      }
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
      await this.prisma.member.update({ where: { id }, data: { constituencyId: toGroupId } });
    } else {
      if (!m.basontas.some((b) => b.groupId === fromGroupId)) throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      await this.prisma.$transaction([
        this.prisma.memberBasonta.delete({ where: { memberId_groupId: { memberId: id, groupId: fromGroupId } } }),
        this.prisma.memberBasonta.upsert({ where: { memberId_groupId: { memberId: id, groupId: toGroupId } }, create: { memberId: id, groupId: toGroupId }, update: {} }),
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
      include: { group: { include: { shepherds: { select: { userId: true } } } }, recordedBy: { select: { fullName: true } } },
    });
    if (!s) throw notFound('Attendance');
    const canEdit = s.group ? this.policy.canManageGroup(user, ref(s.group)) : this.policy.canRecordSunday(user);
    const where: Prisma.MemberWhereInput = !s.group ? {} : s.group.type === 'CONSTITUENCY' ? { constituencyId: s.group.id } : { basontas: { some: { groupId: s.group.id } } };
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
      select: { id: true, fullName: true, churchRole: true, constituency: { select: { id: true, name: true } } },
      orderBy: { fullName: 'asc' },
    });
    return {
      session: this.sessionInfo(s),
      roster: roster.map((m) => ({ id: m.id, fullName: m.fullName, churchRole: m.churchRole, constituency: m.constituency?.name ?? null, constituencyId: m.constituency?.id ?? null })),
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
      this.prisma.churchGroup.findMany({ where: { type: 'BASONTA', isActive: true }, select: { id: true, name: true, _count: { select: { basonta: { where: { member: { isActive: true } } } } } }, orderBy: { name: 'asc' } }),
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
      basontas: basontas.map((c) => ({ id: c.id, name: c.name, members: c._count.basonta })),
      groups: groups.map((g) => {
        const s = stats.get(g.id);
        return {
          id: g.id,
          type: g.type,
          name: g.name,
          pastor: g.pastor?.fullName ?? null,
          members: g.type === 'CONSTITUENCY' ? g._count.members : g._count.basonta,
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
