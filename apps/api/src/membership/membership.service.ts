import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type GroupType, type AttendanceKind } from '@wcc/db';
import type { AttendanceSheetDto, AttendanceSummaryDto, GroupDto, MemberDto, PastorDto } from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { fromDateOnly, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

const pastorSelect = { id: true, fullName: true, title: true, phone: true, email: true } as const;
const groupRef = { id: true, name: true, pastorId: true, createdById: true } as const;
const memberInclude = {
  constituency: { select: groupRef },
  basontas: { include: { group: { select: groupRef } } },
} as const;
type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;

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
}
export interface SheetInput {
  kind: AttendanceKind;
  groupId?: string | null;
  date: string;
  presentIds: string[];
  rosterIds: string[];
  visitorCount?: number;
  firstTimerCount?: number;
  notes?: string | null;
  title?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);
const conflict = (code: string, msg: string) => new AppException(HttpStatus.CONFLICT, code, msg);

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

  private async groupDtos(user: AuthUser, groups: Array<Prisma.ChurchGroupGetPayload<{ include: { pastor: { select: typeof pastorSelect }; _count: { select: { members: true; basonta: true } } } }>>): Promise<GroupDto[]> {
    const ids = groups.map((g) => g.id);
    const last = ids.length
      ? await this.prisma.attendanceSession.findMany({
          where: { kind: 'GROUP_MEETING', groupId: { in: ids } },
          orderBy: { date: 'desc' },
          distinct: ['groupId'],
          select: { groupId: true, date: true, _count: { select: { records: true } } },
        })
      : [];
    const lastBy = new Map(last.map((l) => [l.groupId!, l]));
    return groups.map((g) => {
      const l = lastBy.get(g.id);
      return {
        id: g.id,
        type: g.type,
        name: g.name,
        description: g.description,
        meetingDay: g.meetingDay,
        meetingPlace: g.meetingPlace,
        isActive: g.isActive,
        pastor: g.pastor as PastorDto | null,
        memberCount: g.type === 'CONSTITUENCY' ? g._count.members : g._count.basonta,
        lastMeeting: l ? { date: fromDateOnly(l.date)!, present: l._count.records } : null,
        canManage: this.policy.canManageGroup(user, g),
      };
    });
  }

  private groupQuery = { pastor: { select: pastorSelect }, _count: { select: { members: { where: { isActive: true } }, basonta: { where: { member: { isActive: true } } } } } } as const;

  async listGroups(user: AuthUser, type?: GroupType): Promise<GroupDto[]> {
    this.assertView(user);
    const groups = await this.prisma.churchGroup.findMany({ where: type ? { type } : {}, include: this.groupQuery, orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    return this.groupDtos(user, groups);
  }

  async getGroup(user: AuthUser, id: string): Promise<GroupDto & { createdAt: Date }> {
    this.assertView(user);
    const g = await this.prisma.churchGroup.findUnique({ where: { id }, include: this.groupQuery });
    if (!g) throw notFound('Group');
    const [dto] = await this.groupDtos(user, [g]);
    return { ...dto!, createdAt: g.createdAt };
  }

  async pastors(user: AuthUser): Promise<PastorDto[]> {
    if (!this.policy.canAssignPastor(user)) return user.role === 'PASTOR' ? this.prisma.user.findMany({ where: { id: user.id }, select: pastorSelect }) : [];
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['PASTOR', 'SUPER_ADMIN'] } },
      select: pastorSelect,
      orderBy: { fullName: 'asc' },
    });
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
    // A pastor creating a group leads it; admins may pick anyone (default: none).
    if (!this.policy.canAssignPastor(user) && dto.pastorId && dto.pastorId !== user.id) throw forbidden('Only a Super Admin can choose another pastor');
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
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('GROUP_EXISTS', `A ${dto.type.toLowerCase()} called “${dto.name.trim()}” already exists`);
      throw e;
    }
  }

  private async loadManagedGroup(user: AuthUser, id: string) {
    const g = await this.prisma.churchGroup.findUnique({ where: { id } });
    if (!g) throw notFound('Group');
    if (!this.policy.canManageGroup(user, g)) throw forbidden('Only this group’s pastor or a Super Admin can do that');
    return g;
  }

  async updateGroup(user: AuthUser, id: string, dto: GroupInput, meta: ReqMeta): Promise<GroupDto> {
    const before = await this.loadManagedGroup(user, id);
    const pastorId = await this.resolvePastor(user, dto.pastorId);
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
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('GROUP_EXISTS', 'Another group already has that name');
      throw e;
    }
    await this.audit.record({ actorId: user.id, action: 'GROUP_UPDATED', entityType: 'GROUP', entityId: id, metadata: { before: { name: before.name, pastorId: before.pastorId }, after: { ...dto } }, meta });
    return this.getGroup(user, id);
  }

  async deleteGroup(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const g = await this.loadManagedGroup(user, id);
    // Members stay (their constituency becomes empty); meeting history for this group is removed.
    await this.prisma.churchGroup.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'GROUP_DELETED', entityType: 'GROUP', entityId: id, metadata: { type: g.type, name: g.name }, meta });
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

  private memberGroups(m: MemberRow) {
    return [...(m.constituency ? [m.constituency] : []), ...m.basontas.map((b) => b.group)];
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
    q: { q?: string; constituencyId?: string; basontaId?: string; status?: 'active' | 'inactive' | 'all'; page?: number; limit?: number },
  ): Promise<{ items: MemberDto[]; total: number; page: number; pageSize: number }> {
    this.assertView(user);
    const pageSize = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const page = Math.max(q.page ?? 1, 1);
    const term = q.q?.trim();
    const where: Prisma.MemberWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.constituencyId === 'none' ? { constituencyId: null } : q.constituencyId ? { constituencyId: q.constituencyId } : {}),
      ...(q.basontaId ? { basontas: { some: { groupId: q.basontaId } } } : {}),
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
    const m = await this.prisma.member.findUnique({ where: { id }, include: memberInclude });
    if (!m) throw notFound('Member');
    const history = await this.prisma.attendanceRecord.findMany({
      where: { memberId: id },
      include: { session: { select: { id: true, kind: true, date: true, group: { select: { id: true, name: true } } } } },
      orderBy: { session: { date: 'desc' } },
      take: 30,
    });
    const seen = await this.lastSeen([id]);
    return {
      ...this.toMemberDto(user, m, seen.get(id) ?? null),
      history: history.map((h) => ({ sessionId: h.session.id, kind: h.session.kind, date: fromDateOnly(h.session.date)!, group: h.session.group })),
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
    if (!this.policy.canCreateGroup(user)) throw forbidden('Only pastors and Super Admins can add members');
    if (!dto.fullName?.trim()) throw badRequest('INVALID', 'Full name is required');
    await this.validateGroups(dto.constituencyId, dto.basontaIds);
    const data = this.memberData(dto);
    if (data.phone) {
      const dup = await this.prisma.member.findFirst({ where: { phone: data.phone }, select: { fullName: true } });
      if (dup) throw conflict('MEMBER_EXISTS', `${dup.fullName} already has the phone number ${data.phone}`);
    }
    const m = await this.prisma.member.create({
      data: {
        ...data,
        fullName: data.fullName!,
        createdById: user.id,
        basontas: dto.basontaIds?.length ? { create: [...new Set(dto.basontaIds)].map((groupId) => ({ groupId })) } : undefined,
      },
    });
    await this.audit.record({ actorId: user.id, action: 'MEMBER_CREATED', entityType: 'MEMBER', entityId: m.id, metadata: { fullName: m.fullName }, meta });
    return this.getMember(user, m.id);
  }

  private async loadEditableMember(user: AuthUser, id: string) {
    const m = await this.prisma.member.findUnique({ where: { id }, include: memberInclude });
    if (!m) throw notFound('Member');
    if (!this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) }))
      throw forbidden('Only the pastor of this member’s group or a Super Admin can change this member');
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

  async deleteMember(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const m = await this.loadEditableMember(user, id);
    await this.prisma.member.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'MEMBER_DELETED', entityType: 'MEMBER', entityId: id, metadata: { fullName: m.fullName }, meta });
  }

  // ---------------------------------------------------------------- attendance

  private async sheetContext(user: AuthUser, kind: AttendanceKind, groupId?: string | null) {
    if (kind === 'SUNDAY_SERVICE') {
      if (groupId) throw badRequest('INVALID', 'Sunday services are church-wide');
      return { group: null, canEdit: this.policy.canRecordSunday(user), where: {} as Prisma.MemberWhereInput };
    }
    if (!groupId) throw badRequest('INVALID', 'Choose a group');
    const g = await this.prisma.churchGroup.findUnique({ where: { id: groupId } });
    if (!g) throw notFound('Group');
    const where: Prisma.MemberWhereInput = g.type === 'CONSTITUENCY' ? { constituencyId: g.id } : { basontas: { some: { groupId: g.id } } };
    return { group: g, canEdit: this.policy.canManageGroup(user, g), where };
  }

  private checkDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw badRequest('INVALID_DATE', 'Choose a valid date');
    if (date > today()) throw badRequest('FUTURE_DATE', 'Attendance can’t be recorded for a future date');
  }

  async getSheet(user: AuthUser, q: { kind: AttendanceKind; groupId?: string; date: string }): Promise<AttendanceSheetDto> {
    this.assertView(user);
    this.checkDate(q.date);
    const ctx = await this.sheetContext(user, q.kind, q.groupId);
    const date = toDateOnly(q.date);
    const session = await this.prisma.attendanceSession.findFirst({
      where: { kind: q.kind, groupId: ctx.group?.id ?? null, date },
      include: { records: { select: { memberId: true } }, recordedBy: { select: { fullName: true } } },
    });
    const presentIds = session?.records.map((r) => r.memberId) ?? [];
    const roster = await this.prisma.member.findMany({
      // Active members of the group, plus anyone already marked present (even if since made inactive).
      where: { OR: [{ ...ctx.where, isActive: true }, ...(presentIds.length ? [{ id: { in: presentIds } }] : [])] },
      select: { id: true, fullName: true, churchRole: true, constituency: { select: { id: true, name: true } } },
      orderBy: { fullName: 'asc' },
    });
    return {
      session: session
        ? {
            id: session.id,
            visitorCount: session.visitorCount,
            firstTimerCount: session.firstTimerCount,
            notes: session.notes,
            title: session.title,
            recordedBy: session.recordedBy?.fullName ?? null,
            updatedAt: session.updatedAt.toISOString(),
          }
        : null,
      kind: q.kind,
      group: ctx.group ? { id: ctx.group.id, name: ctx.group.name, type: ctx.group.type } : null,
      date: q.date,
      roster: roster.map((m) => ({ id: m.id, fullName: m.fullName, churchRole: m.churchRole, constituency: m.constituency?.name ?? null, constituencyId: m.constituency?.id ?? null })),
      presentIds,
      canEdit: ctx.canEdit,
    };
  }

  /**
   * Saves a sheet. Only members in `rosterIds` (the ones shown to the person saving) are
   * changed, so two pastors marking different constituencies on the same Sunday don't
   * overwrite each other.
   */
  async saveSheet(user: AuthUser, dto: SheetInput, meta: ReqMeta): Promise<AttendanceSheetDto> {
    this.checkDate(dto.date);
    const ctx = await this.sheetContext(user, dto.kind, dto.groupId);
    if (!ctx.canEdit) throw forbidden(dto.kind === 'SUNDAY_SERVICE' ? 'Only pastors and Super Admins can record Sunday attendance' : 'Only this group’s pastor or a Super Admin can take its attendance');
    const roster = [...new Set(dto.rosterIds)];
    const present = [...new Set(dto.presentIds)].filter((id) => roster.includes(id));
    const existing = new Set((await this.prisma.member.findMany({ where: { id: { in: roster } }, select: { id: true } })).map((m) => m.id));
    const date = toDateOnly(dto.date);
    const groupId = ctx.group?.id ?? null;
    const sessionId = await this.prisma.$transaction(async (tx) => {
      let s = await tx.attendanceSession.findFirst({ where: { kind: dto.kind, groupId, date } });
      const fields = {
        visitorCount: dto.visitorCount ?? s?.visitorCount ?? 0,
        firstTimerCount: dto.firstTimerCount ?? s?.firstTimerCount ?? 0,
        notes: dto.notes === undefined ? (s?.notes ?? null) : blank(dto.notes) ?? null,
        title: dto.title === undefined ? (s?.title ?? null) : blank(dto.title) ?? null,
        recordedById: user.id,
      };
      s = s
        ? await tx.attendanceSession.update({ where: { id: s.id }, data: fields })
        : await tx.attendanceSession.create({ data: { kind: dto.kind, groupId, date, ...fields } });
      await tx.attendanceRecord.deleteMany({ where: { sessionId: s.id, memberId: { in: roster.filter((id) => !present.includes(id)) } } });
      const add = present.filter((id) => existing.has(id));
      if (add.length) await tx.attendanceRecord.createMany({ data: add.map((memberId) => ({ sessionId: s.id, memberId })), skipDuplicates: true });
      return s.id;
    });
    await this.audit.record({
      actorId: user.id,
      action: 'ATTENDANCE_SAVED',
      entityType: 'ATTENDANCE',
      entityId: sessionId,
      metadata: { kind: dto.kind, groupId, date: dto.date, present: present.length, visitors: dto.visitorCount ?? null },
      meta,
    });
    return this.getSheet(user, { kind: dto.kind, groupId: groupId ?? undefined, date: dto.date });
  }

  async deleteSession(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const s = await this.prisma.attendanceSession.findUnique({ where: { id }, include: { group: true } });
    if (!s) throw notFound('Attendance');
    const ok = s.kind === 'SUNDAY_SERVICE' ? this.policy.isMembershipAdmin(user) || this.policy.canRecordSunday(user) : this.policy.canManageGroup(user, s.group!);
    if (!ok) throw forbidden();
    await this.prisma.attendanceSession.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'ATTENDANCE_DELETED', entityType: 'ATTENDANCE', entityId: id, metadata: { kind: s.kind, date: fromDateOnly(s.date), group: s.group?.name ?? null }, meta });
  }

  async listSessions(user: AuthUser, q: { kind?: AttendanceKind; groupId?: string; from?: string; to?: string }) {
    this.assertView(user);
    const rows = await this.prisma.attendanceSession.findMany({
      where: {
        kind: q.kind,
        groupId: q.groupId,
        date: { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined },
      },
      include: { group: { select: { id: true, name: true, type: true } }, _count: { select: { records: true } } },
      orderBy: { date: 'desc' },
      take: 200,
    });
    return rows.map((s) => ({
      id: s.id,
      kind: s.kind,
      date: fromDateOnly(s.date)!,
      group: s.group,
      present: s._count.records,
      visitors: s.visitorCount,
      firstTimers: s.firstTimerCount,
    }));
  }

  async summary(user: AuthUser, q: { from?: string; to?: string }): Promise<AttendanceSummaryDto> {
    this.assertView(user);
    const to = q.to ?? today();
    const from = q.from ?? new Date(Date.parse(to) - 55 * 86_400_000).toISOString().slice(0, 10);
    if (from > to) throw badRequest('INVALID_RANGE', '“From” must be before “To”');
    const [f, t] = [toDateOnly(from), toDateOnly(to)];

    const [activeMembers, sundays, byCon, constituencies, groups, groupStats, absent] = await Promise.all([
      this.prisma.member.count({ where: { isActive: true } }),
      this.prisma.attendanceSession.findMany({
        where: { kind: 'SUNDAY_SERVICE', date: { gte: f, lte: t } },
        include: { _count: { select: { records: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ sessionId: string; constituencyId: string | null; n: number }>>`
        SELECT r."sessionId", m."constituencyId", count(*)::int AS n
        FROM "AttendanceRecord" r
        JOIN "AttendanceSession" s ON s.id = r."sessionId"
        JOIN "Member" m ON m.id = r."memberId"
        WHERE s."kind" = 'SUNDAY_SERVICE' AND s."date" BETWEEN ${f}::date AND ${t}::date
        GROUP BY 1, 2`,
      this.prisma.churchGroup.findMany({
        where: { type: 'CONSTITUENCY', isActive: true },
        select: { id: true, name: true, _count: { select: { members: { where: { isActive: true } } } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.churchGroup.findMany({ where: { isActive: true }, include: this.groupQuery, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.$queryRaw<Array<{ groupId: string; meetings: number; present: number; last: Date | null }>>`
        SELECT s."groupId", count(DISTINCT s.id)::int AS meetings, count(r."memberId")::int AS present, max(s."date") AS last
        FROM "AttendanceSession" s LEFT JOIN "AttendanceRecord" r ON r."sessionId" = s.id
        WHERE s."kind" = 'GROUP_MEETING' AND s."date" BETWEEN ${f}::date AND ${t}::date
        GROUP BY 1`,
      // Active members (who had joined by the start) not seen at any service or meeting in the range.
      this.prisma.$queryRaw<Array<{ id: string; fullName: string; phone: string | null; constituency: string | null }>>`
        SELECT m.id, m."fullName", m.phone, g.name AS constituency
        FROM "Member" m LEFT JOIN "ChurchGroup" g ON g.id = m."constituencyId"
        WHERE m."isActive" AND (m."joinedOn" IS NULL OR m."joinedOn" <= ${f}::date)
          AND NOT EXISTS (
            SELECT 1 FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
            WHERE r."memberId" = m.id AND s."date" BETWEEN ${f}::date AND ${t}::date)
        ORDER BY g.name NULLS LAST, m."fullName"
        LIMIT 300`,
    ]);

    const conBySession = new Map<string, Record<string, number>>();
    for (const r of byCon) {
      const m = conBySession.get(r.sessionId) ?? {};
      m[r.constituencyId ?? 'none'] = r.n;
      conBySession.set(r.sessionId, m);
    }
    const stats = new Map(groupStats.map((s) => [s.groupId, s]));
    const seen = await this.lastSeen(absent.map((a) => a.id));
    const anySession = sundays.length > 0 || groupStats.length > 0;

    return {
      from,
      to,
      activeMembers,
      sundays: sundays.map((s) => ({
        id: s.id,
        date: fromDateOnly(s.date)!,
        present: s._count.records,
        visitors: s.visitorCount,
        firstTimers: s.firstTimerCount,
        byConstituency: conBySession.get(s.id) ?? {},
      })),
      constituencies: constituencies.map((c) => ({ id: c.id, name: c.name, members: c._count.members })),
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
      // With no records at all in the range, "absent" would just mean "everyone".
      absentees: anySession ? absent.map((a) => ({ ...a, lastSeen: seen.get(a.id) ?? null })) : [],
    };
  }
}
