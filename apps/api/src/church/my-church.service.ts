import { Injectable } from '@nestjs/common';
import type { MyChurchDto, PastorDto } from '@wcc/shared';
import { badRequest } from '../common/errors';
import { fromDateOnly, toDateOnly } from '../common/pagination';
import { tenDigitPhone } from './audience.service';
import { pastorSelect, blank, conflict, today, rosterDto } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MembersService } from '../membership/members.service';
import { GroupsService } from '../membership/groups.service';

/** A member’s own view: groups, leaders, duties, attendance. */
@Injectable()
export class MyChurchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly members: MembersService,
    private readonly groups: GroupsService,
  ) {}

  private async myMemberId(user: AuthUser) {
    return (
      (await this.prisma.user.findUnique({ where: { id: user.id }, select: { memberId: true } }))?.memberId ??
      null
    );
  }

  async myChurch(user: AuthUser): Promise<MyChurchDto> {
    const memberId = await this.myMemberId(user);
    if (!memberId) return { member: null, leaders: [], attendance: [], birthdays: [], roster: [] };
    const m = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { constituencyId: true, basontaId: true, bacentas: { select: { groupId: true } } },
    });
    const groupIds = [m.basontaId, m.constituencyId, ...m.bacentas.map((b) => b.groupId)].filter(
      (g): g is string => !!g,
    );
    const [member, groups, attendance, roster] = await Promise.all([
      this.members.memberForSelf(memberId, user),
      this.prisma.churchGroup.findMany({
        where: { id: { in: groupIds } },
        select: {
          id: true,
          name: true,
          type: true,
          pastor: { select: pastorSelect },
          shepherds: { select: { user: { select: pastorSelect } } },
        },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { memberId },
        include: {
          session: {
            select: { date: true, serviceType: true, title: true, group: { select: { name: true } } },
          },
        },
        orderBy: { session: { date: 'desc' } },
        take: 12,
      }),
      this.prisma.rosterSlot.findMany({
        where: { memberId, date: { gte: toDateOnly(today()) } },
        include: {
          role: { select: { id: true, name: true } },
          member: { select: { id: true, fullName: true, phone: true } },
        },
        orderBy: { date: 'asc' },
        take: 10,
      }),
    ]);
    const birthdays = (
      await Promise.all(
        groups.map(async (g) =>
          (await this.groups.upcomingBirthdays(user, g.id, 14, true)).map((b) => ({
            ...b,
            group: g.name,
            phone: null,
          })),
        ),
      )
    )
      .flat()
      .filter((b, i, all) => b.id !== memberId && all.findIndex((x) => x.id === b.id) === i)
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, 10);
    return {
      member,
      leaders: groups.map((g) => ({
        group: { id: g.id, name: g.name, type: g.type },
        pastor: g.pastor as PastorDto | null,
        shepherds: g.shepherds.map((s) => s.user as PastorDto),
      })),
      attendance: attendance.map((a) => ({
        date: fromDateOnly(a.session.date)!,
        name: [a.session.group?.name, a.session.serviceType, a.session.title].filter(Boolean).join(' · '),
      })),
      birthdays,
      roster: roster.map((r) => rosterDto(r)),
    };
  }

  /** Members update their own contact details and birthday. */
  async updateMyMember(
    user: AuthUser,
    dto: {
      phone?: string | null;
      location?: string | null;
      dateOfBirth?: string | null;
      email?: string | null;
    },
    meta: ReqMeta,
  ) {
    const memberId = await this.myMemberId(user);
    if (!memberId)
      throw badRequest('NOT_LINKED', 'Your account isn’t linked to a member record yet. Ask a pastor.');
    const phone = dto.phone === undefined ? undefined : tenDigitPhone(dto.phone);
    if (dto.phone && !phone) throw badRequest('PHONE', 'Enter a 10-digit phone number, e.g. 0241234567');
    if (phone) {
      const dup = await this.prisma.member.findFirst({
        where: { phone, id: { not: memberId } },
        select: { id: true },
      });
      if (dup) throw conflict('MEMBER_EXISTS', 'Another member already has that phone number');
    }
    if (dto.dateOfBirth && dto.dateOfBirth > today()) throw badRequest('DATE', 'Choose a date in the past');
    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        phone,
        location: blank(dto.location),
        email: dto.email === undefined ? undefined : dto.email?.trim().toLowerCase() || null,
        dateOfBirth:
          dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'MEMBER_SELF_UPDATED',
      entityType: 'MEMBER',
      entityId: memberId,
      metadata: { fields: Object.keys(dto) },
      meta,
    });
    return this.myChurch(user);
  }
}
