import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@wcc/db';
import type { RosterSlotDto } from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService, type GroupRef } from '../policy/policy.service';
import { MembersService } from '../membership/members.service';
import { AppException, forbidden } from '../common/errors';
import { fromDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';

/** Helpers shared by the church services. */
export const pastorSelect = { id: true, fullName: true, title: true, phone: true, email: true } as const;
export const blank = (v: string | null | undefined) =>
  v === undefined ? undefined : v?.trim() ? v.trim() : null;
export const conflict = (code: string, msg: string) => new AppException(HttpStatus.CONFLICT, code, msg);
export const today = () => new Date().toISOString().slice(0, 10);
export const isLeaderRole = (r: string) => r === 'SUPER_ADMIN' || r === 'PASTOR' || r === 'SHEPHERD';
export const groupRef = {
  pastorId: true,
  createdById: true,
  shepherds: { select: { userId: true } },
  parent: { select: { pastorId: true } },
} as const;
export const ref = (g: {
  pastorId: string | null;
  createdById: string | null;
  shepherds: Array<{ userId: string }>;
  parent?: { pastorId: string | null } | null;
}): GroupRef => ({
  pastorId: g.pastorId,
  createdById: g.createdById,
  shepherdIds: g.shepherds.map((s) => s.userId),
  parentPastorId: g.parent?.pastorId ?? null,
});

export function rosterDto(
  r: Prisma.RosterSlotGetPayload<{
    include: {
      role: { select: { id: true; name: true } };
      member: { select: { id: true; fullName: true; phone: true } };
    };
  }>,
): RosterSlotDto {
  return {
    id: r.id,
    date: fromDateOnly(r.date)!,
    service: r.service,
    role: r.role,
    member: r.member,
    note: r.note,
  };
}

/** Who may do what with church records (shared by several services). */
@Injectable()
export class ChurchAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly members: MembersService,
  ) {}

  /** Pastors, shepherds and Super Admins. */
  leader(user: AuthUser) {
    if (!this.policy.canAddMembers(user)) throw forbidden('This is for pastors, shepherds and Super Admins');
  }

  /** View: leaders, or the member themselves. Edit: leaders of the member's groups or a Super Admin. */
  async memberAccess(user: AuthUser, memberId: string, edit: boolean) {
    if (edit) {
      if (!(await this.members.canEditMember(user, memberId)))
        throw forbidden('Only the leaders of this member’s groups or a Super Admin can change this');
      return;
    }
    if (this.policy.canViewMembership(user)) return;
    // Members can see their own record.
    const own = await this.prisma.user.count({ where: { id: user.id, memberId } });
    if (!own) throw forbidden();
  }
}
