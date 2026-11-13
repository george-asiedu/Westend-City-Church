import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type GroupType, type GuestIntent } from '@wcc/db';
import type { GuestDto } from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService, type GroupRef } from '../policy/policy.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { fromDateOnly, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';

export const pastorSelect = { id: true, fullName: true, title: true, phone: true, email: true } as const;
export const groupRefSelect = {
  id: true,
  name: true,
  pastorId: true,
  createdById: true,
  shepherds: { select: { userId: true } },
  parent: { select: { pastorId: true } },
} as const;
export const memberInclude = {
  constituency: { select: groupRefSelect },
  basonta: { select: groupRefSelect },
  bacentas: {
    include: {
      group: { select: groupRefSelect },
      roles: { include: { role: { select: { id: true, name: true, sortOrder: true } } } },
    },
  },
} as const;
export type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;
export const activeCounts = {
  members: { where: { isActive: true } },
  basontaMembers: { where: { isActive: true } },
  bacentaMembers: { where: { member: { isActive: true } } },
} as const;
export const groupInclude = {
  pastor: { select: pastorSelect },
  shepherds: { select: { user: { select: pastorSelect } }, orderBy: { createdAt: 'asc' } },
  parent: { select: { id: true, name: true, pastorId: true, pastor: { select: pastorSelect } } },
  children: {
    select: {
      id: true,
      name: true,
      isActive: true,
      pastor: { select: { fullName: true } },
      _count: { select: { basontaMembers: { where: { isActive: true } } } },
    },
    orderBy: { name: 'asc' },
  },
  roles: {
    select: {
      id: true,
      name: true,
      lead: { select: { id: true, fullName: true, phone: true } },
      _count: { select: { members: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  leadMember: { select: { id: true, fullName: true, phone: true } },
  _count: { select: activeCounts },
} as const;
export type GroupRow = Prisma.ChurchGroupGetPayload<{ include: typeof groupInclude }>;

/** Policy view of a group row. */
export const ref = (g: {
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

export const countFor = (
  type: GroupType,
  c: { members: number; basontaMembers: number; bacentaMembers: number },
) => (type === 'CONSTITUENCY' ? c.members : type === 'BASONTA' ? c.basontaMembers : c.bacentaMembers);

/** Members of a group, by type. */
export const memberWhereFor = (g: { id: string; type: GroupType }): Prisma.MemberWhereInput =>
  g.type === 'CONSTITUENCY'
    ? { constituencyId: g.id }
    : g.type === 'BASONTA'
      ? { basontaId: g.id }
      : { bacentas: { some: { groupId: g.id } } };

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
  /** Bacentas: its leaders record church-service head-counts (Super Admin only). */
  recordsServices?: boolean;
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
  /** Church services: total head-count and how many of them were new converts. */
  headcount?: number;
  newConvertCount?: number;
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

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const today = () => new Date().toISOString().slice(0, 10);
export const blank = (v: string | null | undefined) =>
  v === undefined ? undefined : v?.trim() ? v.trim() : null;
export const conflict = (code: string, msg: string) => new AppException(HttpStatus.CONFLICT, code, msg);
export const isUnique = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
export const range = (q: { from?: string; to?: string }, days = 55) => {
  const to = q.to ?? today();
  const from = q.from ?? new Date(Date.parse(to) - days * 86_400_000).toISOString().slice(0, 10);
  if (from > to) throw badRequest('INVALID_RANGE', '“From” must be before “To”');
  return { from, to, f: toDateOnly(from), t: toDateOnly(to) };
};

/** Helpers every part of membership uses: access checks, loading groups, last seen, guests. */
@Injectable()
export class MembershipCore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  assertView(user: AuthUser) {
    if (!this.policy.canViewMembership(user)) throw forbidden('You do not have access to membership records');
  }

  async loadGroup(id: string) {
    const g = await this.prisma.churchGroup.findUnique({
      where: { id },
      include: { shepherds: { select: { userId: true } }, parent: { select: { id: true, pastorId: true } } },
    });
    if (!g) throw notFound('Group');
    return g;
  }

  async lastSeen(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRaw<Array<{ memberId: string; last: Date }>>`
      SELECT r."memberId", max(s."date") AS last
      FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
      WHERE r."memberId" = ANY(${ids}::uuid[])
      GROUP BY r."memberId"`;
    return new Map(rows.map((r) => [r.memberId, fromDateOnly(r.last)!]));
  }

  checkDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
      throw badRequest('INVALID_DATE', 'Choose a valid date');
    if (date > today()) throw badRequest('FUTURE_DATE', 'Attendance can’t be recorded for a future date');
  }

  guestDto(
    g: Prisma.GuestGetPayload<{ include: { convertedMember: { select: { id: true; fullName: true } } } }> & {
      broughtBy?: { id: string; fullName: string } | null;
      session?: {
        id: string;
        date: Date;
        serviceType: string;
        title: string | null;
        group: { id: string; name: string } | null;
      } | null;
    },
  ): GuestDto {
    return {
      id: g.id,
      fullName: g.fullName,
      phone: g.phone,
      intent: g.intent,
      broughtBy: g.broughtBy ?? null,
      convertedMember: g.convertedMember,
      fromCard: !g.sessionId,
      location: g.location,
      howHeard: g.howHeard,
      prayerRequest: g.prayerRequest,
      createdAt: g.createdAt.toISOString(),
      ...(g.session
        ? {
            session: {
              id: g.session.id,
              date: fromDateOnly(g.session.date)!,
              serviceType: g.session.serviceType,
              title: g.session.title,
              group: g.session.group,
            },
          }
        : {}),
    };
  }
}
