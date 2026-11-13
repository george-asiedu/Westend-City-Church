import { Injectable } from '@nestjs/common';
import type { MilestoneDto } from '@wcc/shared';
import { badRequest, notFound } from '../common/errors';
import { fromDateOnly, toDateOnly } from '../common/pagination';
import { blank, today, ChurchAccess } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Milestones and check-in households on a member’s record. */
@Injectable()
export class MemberRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ChurchAccess,
  ) {}

  async household(user: AuthUser, memberId: string) {
    await this.access.memberAccess(user, memberId, false);
    const m = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: {
        guardian: { select: { id: true, fullName: true, phone: true } },
        dependants: { select: { id: true, fullName: true, phone: true }, orderBy: { fullName: 'asc' } },
      },
    });
    if (!m) throw notFound('Member');
    return { guardian: m.guardian, dependants: m.dependants };
  }

  /** "Checks in with": a parent/relative who checks this member in at the QR code. */
  async setGuardian(user: AuthUser, memberId: string, guardianId: string | null, meta: ReqMeta) {
    await this.access.memberAccess(user, memberId, true);
    if (guardianId) {
      if (guardianId === memberId) throw badRequest('GUARDIAN', 'Someone can’t check themselves in');
      const g = await this.prisma.member.findUnique({
        where: { id: guardianId },
        select: { guardianId: true, isActive: true },
      });
      if (!g?.isActive) throw badRequest('GUARDIAN', 'Choose an active member');
      if (g.guardianId === memberId) throw badRequest('GUARDIAN', 'They already check in with this member');
    }
    await this.prisma.member.update({ where: { id: memberId }, data: { guardianId } });
    await this.audit.record({
      actorId: user.id,
      action: 'MEMBER_GUARDIAN_SET',
      entityType: 'MEMBER',
      entityId: memberId,
      metadata: { guardianId },
      meta,
    });
    return this.household(user, memberId);
  }

  async milestones(user: AuthUser, memberId: string): Promise<MilestoneDto[]> {
    await this.access.memberAccess(user, memberId, false);
    const rows = await this.prisma.milestone.findMany({ where: { memberId }, orderBy: { date: 'desc' } });
    return rows.map((r) => ({ id: r.id, type: r.type, date: fromDateOnly(r.date)!, note: r.note }));
  }

  async addMilestone(
    user: AuthUser,
    memberId: string,
    dto: { type: string; date: string; note?: string | null },
    meta: ReqMeta,
  ) {
    await this.access.memberAccess(user, memberId, true);
    if (dto.date > today()) throw badRequest('FUTURE_DATE', 'A milestone can’t be in the future');
    await this.prisma.milestone.create({
      data: {
        memberId,
        type: dto.type.trim(),
        date: toDateOnly(dto.date),
        note: blank(dto.note) ?? null,
        createdById: user.id,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'MILESTONE_ADDED',
      entityType: 'MEMBER',
      entityId: memberId,
      metadata: { type: dto.type, date: dto.date },
      meta,
    });
    return this.milestones(user, memberId);
  }

  async removeMilestone(user: AuthUser, memberId: string, id: string, meta: ReqMeta) {
    await this.access.memberAccess(user, memberId, true);
    await this.prisma.milestone.deleteMany({ where: { id, memberId } });
    await this.audit.record({
      actorId: user.id,
      action: 'MILESTONE_REMOVED',
      entityType: 'MEMBER',
      entityId: memberId,
      meta,
    });
  }
}
