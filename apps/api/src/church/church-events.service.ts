import { Injectable } from '@nestjs/common';
import { Prisma, type RsvpStatus } from '@wcc/db';
import type { ChurchEventDto, Page } from '@wcc/shared';
import { badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, pageOf, pageSize } from '../common/pagination';
import { blank, groupRef, ref } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { AudienceService } from './audience.service';

/** Calendar events and RSVPs. */
@Injectable()
export class ChurchEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly audience: AudienceService,
  ) {}

  private eventInclude = {
    group: { select: { id: true, name: true, ...groupRef } },
    rsvps: { select: { userId: true, status: true, guests: true } },
  } satisfies Prisma.ChurchEventInclude;

  private eventDto(
    user: AuthUser,
    e: Prisma.ChurchEventGetPayload<{ include: ChurchEventsService['eventInclude'] }>,
  ): ChurchEventDto {
    const going = e.rsvps.filter((r) => r.status === 'GOING');
    const mine = e.rsvps.find((r) => r.userId === user.id);
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      location: e.location,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt?.toISOString() ?? null,
      group: e.group ? { id: e.group.id, name: e.group.name } : null,
      rsvpEnabled: e.rsvpEnabled,
      capacity: e.capacity,
      counts: {
        going: going.length,
        maybe: e.rsvps.filter((r) => r.status === 'MAYBE').length,
        notGoing: e.rsvps.filter((r) => r.status === 'NOT_GOING').length,
        people: going.reduce((a, r) => a + 1 + r.guests, 0),
      },
      myRsvp: mine ? { status: mine.status, guests: mine.guests } : null,
      canEdit:
        this.policy.isMembershipAdmin(user) ||
        (!!e.group && this.policy.canManageGroup(user, ref(e.group))) ||
        e.createdById === user.id,
    };
  }

  /** Church-wide events are for everyone; group events for that group's people and admins. */
  private async eventScope(user: AuthUser): Promise<Prisma.ChurchEventWhereInput> {
    if (this.policy.isMembershipAdmin(user) || this.policy.canViewChurchStats(user)) return {};
    return { OR: [{ groupId: null }, { groupId: { in: await this.audience.groupsOfUser(user.id) } }] };
  }

  async events(
    user: AuthUser,
    q: { when?: 'upcoming' | 'past'; cursor?: string; limit?: number },
  ): Promise<Page<ChurchEventDto>> {
    const take = pageSize(q.limit);
    const now = new Date();
    const past = q.when === 'past';
    const rows = await this.prisma.churchEvent.findMany({
      where: {
        AND: [
          await this.eventScope(user),
          past
            ? { OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }] }
            : { OR: [{ endsAt: { gte: now } }, { startsAt: { gte: now } }] },
        ],
      },
      include: this.eventInclude,
      orderBy: [{ startsAt: past ? 'desc' : 'asc' }, { id: 'asc' }],
      ...cursorArgs(q.cursor, take),
    });
    const { items, nextCursor } = pageOf(rows, take);
    return { items: items.map((e) => this.eventDto(user, e)), nextCursor };
  }

  private async checkEventGroup(user: AuthUser, groupId: string | null | undefined) {
    if (!groupId) {
      if (!this.policy.isMembershipAdmin(user))
        throw forbidden('Only a Super Admin can add church-wide events');
      return;
    }
    const g = await this.prisma.churchGroup.findUnique({ where: { id: groupId }, select: groupRef });
    if (!g) throw notFound('Group');
    if (!this.policy.canManageGroup(user, ref(g)))
      throw forbidden('You can only add events for groups you lead');
  }

  async createEvent(
    user: AuthUser,
    dto: {
      title: string;
      description?: string | null;
      location?: string | null;
      startsAt: string;
      endsAt?: string | null;
      groupId?: string | null;
      rsvpEnabled?: boolean;
      capacity?: number | null;
    },
    meta: ReqMeta,
  ) {
    await this.checkEventGroup(user, dto.groupId);
    if (dto.endsAt && dto.endsAt < dto.startsAt) throw badRequest('DATES', 'The end must be after the start');
    const e = await this.prisma.churchEvent.create({
      data: {
        title: dto.title.trim(),
        description: blank(dto.description) ?? null,
        location: blank(dto.location) ?? null,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        groupId: dto.groupId ?? null,
        rsvpEnabled: dto.rsvpEnabled ?? true,
        capacity: dto.capacity ?? null,
        createdById: user.id,
      },
      include: this.eventInclude,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'CHURCH_EVENT_CREATED',
      entityType: 'GROUP',
      entityId: dto.groupId ?? null,
      metadata: { title: e.title },
      meta,
    });
    return this.eventDto(user, e);
  }

  private async loadEvent(user: AuthUser, id: string, edit: boolean) {
    const e = await this.prisma.churchEvent.findFirst({
      where: { AND: [{ id }, await this.eventScope(user)] },
      include: this.eventInclude,
    });
    if (!e) throw notFound('Event');
    if (edit && !this.eventDto(user, e).canEdit) throw forbidden();
    return e;
  }

  async updateEvent(
    user: AuthUser,
    id: string,
    dto: {
      title?: string;
      description?: string | null;
      location?: string | null;
      startsAt?: string;
      endsAt?: string | null;
      rsvpEnabled?: boolean;
      capacity?: number | null;
    },
    meta: ReqMeta,
  ) {
    await this.loadEvent(user, id, true);
    const e = await this.prisma.churchEvent.update({
      where: { id },
      data: {
        title: dto.title?.trim() || undefined,
        description: blank(dto.description),
        location: blank(dto.location),
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt === undefined ? undefined : dto.endsAt ? new Date(dto.endsAt) : null,
        rsvpEnabled: dto.rsvpEnabled,
        capacity: dto.capacity,
      },
      include: this.eventInclude,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'CHURCH_EVENT_UPDATED',
      entityType: 'GROUP',
      entityId: e.groupId,
      metadata: { title: e.title },
      meta,
    });
    return this.eventDto(user, e);
  }

  async deleteEvent(user: AuthUser, id: string, meta: ReqMeta) {
    const e = await this.loadEvent(user, id, true);
    await this.prisma.churchEvent.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'CHURCH_EVENT_DELETED',
      entityType: 'GROUP',
      entityId: e.groupId,
      metadata: { title: e.title },
      meta,
    });
  }

  async rsvp(user: AuthUser, id: string, dto: { status: RsvpStatus; guests?: number }) {
    const e = await this.loadEvent(user, id, false);
    if (!e.rsvpEnabled) throw badRequest('NO_RSVP', 'This event doesn’t take RSVPs');
    if ((e.endsAt ?? e.startsAt) < new Date()) throw badRequest('PAST', 'This event has already happened');
    const guests = dto.status === 'GOING' ? Math.max(0, Math.min(20, dto.guests ?? 0)) : 0;
    if (dto.status === 'GOING' && e.capacity) {
      const taken = e.rsvps
        .filter((r) => r.status === 'GOING' && r.userId !== user.id)
        .reduce((a, r) => a + 1 + r.guests, 0);
      if (taken + 1 + guests > e.capacity)
        throw badRequest('FULL', `Sorry, it’s full (${e.capacity} places)`);
    }
    await this.prisma.eventRsvp.upsert({
      where: { eventId_userId: { eventId: id, userId: user.id } },
      create: { eventId: id, userId: user.id, status: dto.status, guests },
      update: { status: dto.status, guests },
    });
    return this.eventDto(user, await this.loadEvent(user, id, false));
  }
}
