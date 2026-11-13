import { Injectable } from '@nestjs/common';
import type { RosterSlotDto } from '@wcc/shared';
import { badRequest, forbidden, notFound } from '../common/errors';
import { toDateOnly } from '../common/pagination';
import { blank, today, groupRef, ref, rosterDto } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';

/** Bacenta duty rotas. */
@Injectable()
export class RostersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private async bacentaFor(user: AuthUser, groupId: string, manage: boolean) {
    const g = await this.prisma.churchGroup.findUnique({
      where: { id: groupId },
      select: { id: true, type: true, name: true, ...groupRef },
    });
    if (!g) throw notFound('Group');
    if (g.type !== 'BACENTA') throw badRequest('INVALID', 'Rotas are for bacentas');
    const can = this.policy.canManageGroup(user, ref(g));
    if (manage && !can) throw forbidden('Only this bacenta’s leaders or a Super Admin can change its rota');
    if (!manage && !can && !this.policy.canViewMembership(user)) throw forbidden();
    return g;
  }

  async roster(user: AuthUser, groupId: string, q: { from?: string; to?: string }): Promise<RosterSlotDto[]> {
    await this.bacentaFor(user, groupId, false);
    const from = q.from ?? today();
    const to = q.to ?? new Date(Date.parse(from) + 56 * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.prisma.rosterSlot.findMany({
      where: { groupId, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
      include: {
        role: { select: { id: true, name: true } },
        member: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: [{ date: 'asc' }, { service: 'asc' }, { role: { sortOrder: 'asc' } }],
    });
    return rows.map((r) => rosterDto(r));
  }

  async addRoster(
    user: AuthUser,
    groupId: string,
    dto: {
      date: string;
      service?: string | null;
      roleId?: string | null;
      memberIds: string[];
      note?: string | null;
    },
    meta: ReqMeta,
  ) {
    const g = await this.bacentaFor(user, groupId, true);
    if (dto.date < today()) throw badRequest('PAST_DATE', 'Choose today or a future date');
    if (dto.roleId && !(await this.prisma.bacentaRole.count({ where: { id: dto.roleId, groupId } })))
      throw badRequest('ROLE', 'That team isn’t in this bacenta');
    const inIt = new Set(
      (
        await this.prisma.memberBacenta.findMany({
          where: { groupId, memberId: { in: dto.memberIds } },
          select: { memberId: true },
        })
      ).map((x) => x.memberId),
    );
    const outside = dto.memberIds.filter((m) => !inIt.has(m));
    if (outside.length) throw badRequest('NOT_IN_BACENTA', `Only members of ${g.name} can be on its rota`);
    const date = toDateOnly(dto.date);
    const already = new Set(
      (
        await this.prisma.rosterSlot.findMany({
          where: {
            groupId,
            date,
            roleId: dto.roleId ?? null,
            service: blank(dto.service) ?? null,
            memberId: { in: dto.memberIds },
          },
          select: { memberId: true },
        })
      ).map((x) => x.memberId),
    );
    const add = dto.memberIds.filter((m) => !already.has(m));
    if (add.length)
      await this.prisma.rosterSlot.createMany({
        data: add.map((memberId) => ({
          groupId,
          date,
          service: blank(dto.service) ?? null,
          roleId: dto.roleId ?? null,
          memberId,
          note: blank(dto.note) ?? null,
          createdById: user.id,
        })),
      });
    await this.audit.record({
      actorId: user.id,
      action: 'ROSTER_UPDATED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { date: dto.date, added: add.length },
      meta,
    });
    return this.roster(user, groupId, { from: dto.date, to: dto.date });
  }

  async removeRoster(user: AuthUser, groupId: string, slotId: string, meta: ReqMeta) {
    await this.bacentaFor(user, groupId, true);
    await this.prisma.rosterSlot.deleteMany({ where: { id: slotId, groupId } });
    await this.audit.record({
      actorId: user.id,
      action: 'ROSTER_REMOVED',
      entityType: 'GROUP',
      entityId: groupId,
      metadata: { slotId },
      meta,
    });
  }
}
