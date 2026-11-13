import { Injectable } from '@nestjs/common';
import { Prisma } from '@wcc/db';
import type { MemberDto, Page } from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService, type GroupRef } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, fromDateOnly, pageOf, pageSize, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { memberInclude, MemberRow, ref, MemberInput, today, blank, conflict, MembershipCore } from './core';

/** The member directory. */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly core: MembershipCore,
  ) {}

  private memberGroups(m: MemberRow): GroupRef[] {
    return [
      ...(m.constituency ? [m.constituency] : []),
      ...(m.basonta ? [m.basonta] : []),
      ...m.bacentas.map((b) => b.group),
    ].map(ref);
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
        .map((b) => ({
          id: b.group.id,
          name: b.group.name,
          roles: b.roles
            .map((r) => r.role)
            .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name))
            .map(({ id, name }) => ({ id, name })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      lastSeen,
      canEdit: this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) }),
    };
  }

  async listMembers(
    user: AuthUser,
    q: {
      q?: string;
      constituencyId?: string;
      basontaId?: string;
      bacentaId?: string;
      teamRoleId?: string;
      churchRole?: string;
      leaders?: boolean;
      status?: 'active' | 'inactive' | 'all';
      cursor?: string;
      limit?: number;
    },
  ): Promise<Page<MemberDto> & { total: number }> {
    this.core.assertView(user);
    const take = pageSize(q.limit);
    const term = q.q?.trim();
    const where: Prisma.MemberWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.constituencyId === 'none'
        ? { constituencyId: null }
        : q.constituencyId
          ? { constituencyId: q.constituencyId }
          : {}),
      ...(q.basontaId === 'none' ? { basontaId: null } : q.basontaId ? { basontaId: q.basontaId } : {}),
      ...(q.bacentaId
        ? {
            bacentas: {
              some: {
                groupId: q.bacentaId,
                ...(q.teamRoleId === 'none'
                  ? { roles: { none: {} } }
                  : q.teamRoleId
                    ? { roles: { some: { roleId: q.teamRoleId } } }
                    : {}),
              },
            },
          }
        : {}),
      // Shepherds and leaders by their role in church.
      ...(q.leaders
        ? {
            AND: [
              {
                OR: ['shepherd', 'leader', 'pastor', 'overseer'].map((w) => ({
                  churchRole: { contains: w, mode: 'insensitive' as const },
                })),
              },
            ],
          }
        : {}),
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
      this.prisma.member.findMany({
        where,
        include: memberInclude,
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        ...cursorArgs(q.cursor, take),
      }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    const seen = await this.core.lastSeen(items.map((r) => r.id));
    return { items: items.map((m) => this.toMemberDto(user, m, seen.get(m.id) ?? null)), nextCursor, total };
  }

  /** Can this user edit this member? (Light check: no attendance history is loaded.) */
  async canEditMember(user: AuthUser, id: string): Promise<boolean> {
    if (!this.policy.canViewMembership(user)) return false;
    const m = await this.prisma.member.findUnique({ where: { id }, include: memberInclude });
    return (
      !!m && this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) })
    );
  }

  /** A member's own record (for their "My church" page). */
  async memberForSelf(id: string, user: AuthUser) {
    const m = await this.prisma.member.findUniqueOrThrow({ where: { id }, include: memberInclude });
    return { ...this.toMemberDto(user, m, null), canEdit: false };
  }

  async getMember(user: AuthUser, id: string) {
    this.core.assertView(user);
    const m = await this.prisma.member.findUnique({
      where: { id },
      include: {
        ...memberInclude,
        convertedFrom: { include: { broughtBy: { select: { id: true, fullName: true } } } },
      },
    });
    if (!m) throw notFound('Member');
    const [history, brought] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { memberId: id },
        include: {
          session: {
            select: {
              id: true,
              kind: true,
              serviceType: true,
              title: true,
              date: true,
              group: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { session: { date: 'desc' } },
        take: 30,
      }),
      this.prisma.guest.findMany({
        where: { broughtById: id },
        include: {
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
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const seen = await this.core.lastSeen([id]);
    const [account, invite] = await Promise.all([
      this.prisma.user.findFirst({
        where: { memberId: id },
        select: { id: true, status: true, lastLoginAt: true, totpEnabled: true, mustChangePassword: true },
      }),
      this.prisma.invitation.findFirst({
        where: { memberId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { createdAt: true },
      }),
    ]);
    return {
      ...this.toMemberDto(user, m, seen.get(id) ?? null),
      account: account
        ? {
            id: account.id,
            mustChangePassword: account.mustChangePassword,
            status: account.status,
            lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
            twoFactor: account.totpEnabled,
          }
        : null,
      invitedAt: invite?.createdAt.toISOString() ?? null,
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
      brought: brought.map((b) => this.core.guestDto(b)),
    };
  }

  /** Checks group ids and returns the constituency implied by the basonta (if any). */
  private async validateGroups(dto: MemberInput): Promise<string | null | undefined> {
    let constituencyId = dto.constituencyId;
    if (dto.basontaId) {
      const b = await this.prisma.churchGroup.findUnique({
        where: { id: dto.basontaId },
        select: { type: true, parentId: true },
      });
      if (b?.type !== 'BASONTA') throw badRequest('BASONTA_INVALID', 'Choose a valid basonta');
      if (b.parentId) {
        if (constituencyId && constituencyId !== b.parentId)
          throw badRequest('BASONTA_MISMATCH', 'That basonta is in a different constituency');
        constituencyId = b.parentId;
      }
    }
    if (constituencyId) {
      const c = await this.prisma.churchGroup.findUnique({
        where: { id: constituencyId },
        select: { type: true },
      });
      if (c?.type !== 'CONSTITUENCY') throw badRequest('CONSTITUENCY_INVALID', 'Choose a valid constituency');
    }
    if (dto.bacentas?.length) {
      const ids = [...new Set(dto.bacentas.map((b) => b.groupId))];
      const n = await this.prisma.churchGroup.count({ where: { id: { in: ids }, type: 'BACENTA' } });
      if (n !== ids.length) throw badRequest('BACENTA_INVALID', 'Choose valid bacentas');
      const roleIds = dto.bacentas.flatMap((b) => (b.roleIds ?? []).map((r) => ({ r, g: b.groupId })));
      if (roleIds.length) {
        const roles = await this.prisma.bacentaRole.findMany({
          where: { id: { in: roleIds.map((x) => x.r) } },
          select: { id: true, groupId: true },
        });
        const by = new Map(roles.map((r) => [r.id, r.groupId]));
        if (roleIds.some((x) => by.get(x.r) !== x.g))
          throw badRequest('ROLE_INVALID', 'A team role doesn’t belong to that bacenta');
      }
    }
    return constituencyId;
  }

  private async writeBacentas(
    tx: Prisma.TransactionClient,
    memberId: string,
    bacentas: Array<{ groupId: string; roleIds?: string[] }>,
  ) {
    await tx.memberBacenta.deleteMany({ where: { memberId } });
    const uniq = [...new Map(bacentas.map((b) => [b.groupId, b])).values()];
    if (!uniq.length) return;
    await tx.memberBacenta.createMany({ data: uniq.map((b) => ({ memberId, groupId: b.groupId })) });
    const roles = uniq.flatMap((b) =>
      [...new Set(b.roleIds ?? [])].map((roleId) => ({ memberId, groupId: b.groupId, roleId })),
    );
    if (roles.length) await tx.memberBacentaRole.createMany({ data: roles });
  }

  private memberData(dto: MemberInput) {
    return {
      fullName: dto.fullName?.trim() || undefined,
      phone: blank(dto.phone)?.replace(/\s+/g, '') ?? (dto.phone === undefined ? undefined : null),
      email: blank(dto.email)?.toLowerCase() ?? (dto.email === undefined ? undefined : null),
      gender: blank(dto.gender),
      dateOfBirth:
        dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
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
      const dup = await this.prisma.member.findFirst({
        where: { phone: data.phone },
        select: { fullName: true },
      });
      if (dup) throw conflict('MEMBER_EXISTS', `${dup.fullName} already has the phone number ${data.phone}`);
    }
    if (dto.fromGuestId) {
      const g = await this.prisma.guest.findUnique({
        where: { id: dto.fromGuestId },
        select: { convertedMemberId: true },
      });
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
      if (dto.fromGuestId)
        await tx.guest.update({
          where: { id: dto.fromGuestId },
          data: { convertedMemberId: created.id, intent: 'JOINING' },
        });
      return created;
    });
    await this.audit.record({
      actorId: user.id,
      action: dto.fromGuestId ? 'GUEST_CONVERTED' : 'MEMBER_CREATED',
      entityType: 'MEMBER',
      entityId: m.id,
      metadata: { fullName: m.fullName, guestId: dto.fromGuestId ?? null },
      meta,
    });
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
    const constituencyId = await this.validateGroups({
      ...dto,
      basontaId: dto.basontaId === undefined ? undefined : dto.basontaId,
    });
    const data = { ...this.memberData(dto), ...(constituencyId !== undefined ? { constituencyId } : {}) };
    // Changing constituency without choosing a basonta drops a basonta that no longer fits.
    if (
      dto.constituencyId !== undefined &&
      dto.basontaId === undefined &&
      before.basontaId &&
      dto.constituencyId !== before.constituencyId
    )
      data.basontaId = null;
    if (data.phone) {
      const dup = await this.prisma.member.findFirst({
        where: { phone: data.phone, id: { not: id } },
        select: { fullName: true },
      });
      if (dup) throw conflict('MEMBER_EXISTS', `${dup.fullName} already has the phone number ${data.phone}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id }, data });
      if (dto.bacentas) await this.writeBacentas(tx, id, dto.bacentas);
    });
    await this.audit.record({
      actorId: user.id,
      action: 'MEMBER_UPDATED',
      entityType: 'MEMBER',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
      meta,
    });
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
    const [from, to] = await Promise.all([this.core.loadGroup(fromGroupId), this.core.loadGroup(toGroupId)]);
    if (from.type !== to.type)
      throw badRequest('INVALID', 'Members can only move between groups of the same kind');
    if (
      !this.policy.canManageGroup(user, ref(from)) &&
      !this.policy.canEditMember(user, { createdById: m.createdById, groups: this.memberGroups(m) })
    )
      throw forbidden('Only the leaders of this member’s group or a Super Admin can move them');
    if (from.type === 'CONSTITUENCY') {
      if (m.constituencyId !== fromGroupId)
        throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      // Their basonta belonged to the old constituency, so it no longer applies.
      await this.prisma.member.update({
        where: { id },
        data: { constituencyId: toGroupId, basontaId: null },
      });
    } else if (from.type === 'BASONTA') {
      if (m.basontaId !== fromGroupId)
        throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      await this.prisma.member.update({
        where: { id },
        data: { basontaId: toGroupId, ...(to.parentId ? { constituencyId: to.parentId } : {}) },
      });
    } else {
      if (!m.bacentas.some((b) => b.groupId === fromGroupId))
        throw badRequest('NOT_IN_GROUP', `${m.fullName} is not in ${from.name}`);
      // Team roles belong to a bacenta, so they don't carry over.
      await this.prisma.$transaction([
        this.prisma.memberBacenta.delete({
          where: { memberId_groupId: { memberId: id, groupId: fromGroupId } },
        }),
        // They no longer lead anything in the bacenta they left.
        this.prisma.bacentaRole.updateMany({
          where: { groupId: fromGroupId, leadId: id },
          data: { leadId: null },
        }),
        this.prisma.churchGroup.updateMany({
          where: { id: fromGroupId, leadMemberId: id },
          data: { leadMemberId: null },
        }),
        this.prisma.memberBacenta.upsert({
          where: { memberId_groupId: { memberId: id, groupId: toGroupId } },
          create: { memberId: id, groupId: toGroupId },
          update: {},
        }),
      ]);
    }
    await this.audit.record({
      actorId: user.id,
      action: 'MEMBER_MOVED',
      entityType: 'MEMBER',
      entityId: id,
      metadata: { from: from.name, to: to.name },
      meta,
    });
    return this.getMember(user, id);
  }

  async deleteMember(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const m = await this.loadEditableMember(user, id);
    await this.prisma.member.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'MEMBER_DELETED',
      entityType: 'MEMBER',
      entityId: id,
      metadata: { fullName: m.fullName },
      meta,
    });
  }
}
