import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { Prisma, type AnnouncementAudience, type FollowUpStatus, type RsvpStatus } from '@wcc/db';
import type {
  AnnouncementDto,
  ChurchEventDto,
  FollowUpDto,
  ImportRowResult,
  MilestoneDto,
  MyChurchDto,
  Page,
  PastorDto,
  RosterSlotDto,
} from '@wcc/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService, type GroupRef } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, fromDateOnly, pageOf, pageSize, toDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { MembershipService } from '../membership/membership.service';
import { AudienceService, normalizePhone, tenDigitPhone } from './audience.service';

const pastorSelect = { id: true, fullName: true, title: true, phone: true, email: true } as const;
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);
const conflict = (code: string, msg: string) => new AppException(HttpStatus.CONFLICT, code, msg);
const today = () => new Date().toISOString().slice(0, 10);
const isLeaderRole = (r: string) => r === 'SUPER_ADMIN' || r === 'PASTOR' || r === 'SHEPHERD';
const groupRef = { pastorId: true, createdById: true, shepherds: { select: { userId: true } }, parent: { select: { pastorId: true } } } as const;
const ref = (g: { pastorId: string | null; createdById: string | null; shepherds: Array<{ userId: string }>; parent?: { pastorId: string | null } | null }): GroupRef => ({
  pastorId: g.pastorId,
  createdById: g.createdById,
  shepherdIds: g.shepherds.map((s) => s.userId),
  parentPastorId: g.parent?.pastorId ?? null,
});

export interface ImportRow {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  location?: string | null;
  churchRole?: string | null;
  constituency?: string | null;
  basonta?: string | null;
  bacentas?: string | null;
  joinedOn?: string | null;
}

@Injectable()
export class ChurchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly audience: AudienceService,
    private readonly membership: MembershipService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private leader(user: AuthUser) {
    if (!this.policy.canAddMembers(user)) throw forbidden('This is for pastors, shepherds and Super Admins');
  }

  // ================================================================ follow-ups

  private followUpInclude = {
    member: { select: { id: true, fullName: true, phone: true, basonta: { select: { name: true } }, constituency: { select: { name: true } } } },
    guest: { select: { id: true, fullName: true, phone: true } },
    assignedTo: { select: { id: true, fullName: true } },
    createdBy: { select: { id: true, fullName: true } },
    notes: { include: { author: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' as const }, take: 20 },
  } satisfies Prisma.FollowUpInclude;

  private followUpDto(user: AuthUser, f: Prisma.FollowUpGetPayload<{ include: ChurchService['followUpInclude'] }>): FollowUpDto {
    const open = f.status !== 'DONE';
    return {
      id: f.id,
      reason: f.reason,
      status: f.status,
      dueOn: fromDateOnly(f.dueOn),
      overdue: open && !!f.dueOn && fromDateOnly(f.dueOn)! < today(),
      createdAt: f.createdAt.toISOString(),
      closedAt: f.closedAt?.toISOString() ?? null,
      person: f.member
        ? { kind: 'MEMBER', id: f.member.id, fullName: f.member.fullName, phone: f.member.phone, group: f.member.basonta?.name ?? f.member.constituency?.name ?? null }
        : { kind: 'GUEST', id: f.guest!.id, fullName: f.guest!.fullName ?? 'Name not recorded', phone: f.guest!.phone, group: null },
      assignedTo: f.assignedTo,
      createdBy: f.createdBy,
      notes: f.notes.map((n) => ({ id: n.id, text: n.text, status: n.status, author: n.author?.fullName ?? null, createdAt: n.createdAt.toISOString() })),
      canEdit: this.policy.isMembershipAdmin(user) || f.assignedToId === user.id || f.createdById === user.id,
    };
  }

  async followUps(user: AuthUser, q: { scope?: 'mine' | 'all'; state?: 'open' | 'closed'; cursor?: string; limit?: number }): Promise<Page<FollowUpDto> & { total: number; overdue: number }> {
    this.leader(user);
    const scope: Prisma.FollowUpWhereInput =
      q.scope === 'all' && this.policy.isMembershipAdmin(user) ? {} : q.scope === 'all' ? { OR: [{ assignedToId: user.id }, { createdById: user.id }] } : { assignedToId: user.id };
    const where: Prisma.FollowUpWhereInput = { ...scope, status: q.state === 'closed' ? 'DONE' : { not: 'DONE' } };
    const take = pageSize(q.limit);
    const [rows, total, overdue] = await Promise.all([
      this.prisma.followUp.findMany({ where, include: this.followUpInclude, orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }], ...cursorArgs(q.cursor, take) }),
      this.prisma.followUp.count({ where }),
      this.prisma.followUp.count({ where: { ...scope, status: { not: 'DONE' }, dueOn: { lt: toDateOnly(today()) } } }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    return { items: items.map((f) => this.followUpDto(user, f)), nextCursor, total, overdue };
  }

  async assignees(user: AuthUser): Promise<PastorDto[]> {
    this.leader(user);
    return this.prisma.user.findMany({ where: { status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD'] } }, select: pastorSelect, orderBy: { fullName: 'asc' } });
  }

  async createFollowUp(user: AuthUser, dto: { memberId?: string; guestId?: string; reason: string; assignedToId?: string | null; dueOn?: string | null }, meta: ReqMeta) {
    this.leader(user);
    if (!dto.memberId === !dto.guestId) throw badRequest('INVALID', 'Choose one member or one new person');
    const existing = await this.prisma.followUp.findFirst({ where: { memberId: dto.memberId ?? undefined, guestId: dto.guestId ?? undefined, status: { not: 'DONE' } }, include: this.followUpInclude });
    if (existing) throw conflict('FOLLOW_UP_EXISTS', `There’s already an open follow-up for this person (assigned to ${existing.assignedTo?.fullName ?? 'nobody yet'})`);
    const who = dto.memberId
      ? await this.prisma.member.findUnique({ where: { id: dto.memberId }, select: { fullName: true } })
      : await this.prisma.guest.findUnique({ where: { id: dto.guestId! }, select: { fullName: true } });
    if (!who) throw notFound('Person');
    await this.checkAssignee(dto.assignedToId);
    const f = await this.prisma.followUp.create({
      data: {
        memberId: dto.memberId ?? null,
        guestId: dto.guestId ?? null,
        reason: dto.reason.trim(),
        assignedToId: dto.assignedToId ?? user.id,
        createdById: user.id,
        dueOn: dto.dueOn ? toDateOnly(dto.dueOn) : null,
      },
      include: this.followUpInclude,
    });
    await this.notifyAssignee(user, f.assignedToId, who.fullName ?? 'someone', f.reason);
    await this.audit.record({ actorId: user.id, action: 'FOLLOW_UP_CREATED', entityType: 'MEMBER', entityId: dto.memberId ?? null, metadata: { reason: f.reason, assignedTo: f.assignedToId }, meta });
    return this.followUpDto(user, f);
  }

  private async checkAssignee(id: string | null | undefined) {
    if (!id) return;
    const u = await this.prisma.user.findUnique({ where: { id }, select: { status: true, role: true } });
    if (!u || u.status !== 'ACTIVE' || !isLeaderRole(u.role)) throw badRequest('ASSIGNEE', 'Assign it to an active pastor, shepherd or Super Admin');
  }

  private async notifyAssignee(user: AuthUser, assigneeId: string | null, name: string, reason: string) {
    if (!assigneeId || assigneeId === user.id) return;
    await this.queue.push({ userIds: [assigneeId], kind: 'reminder', payload: { title: `Could you check on ${name}?`, body: `${user.fullName} asked if you could reach out. ${reason}`, url: '/church/follow-ups', tag: 'follow-up' } });
  }

  async updateFollowUp(user: AuthUser, id: string, dto: { status?: FollowUpStatus; note?: string; assignedToId?: string | null; dueOn?: string | null }, meta: ReqMeta) {
    this.leader(user);
    const f = await this.prisma.followUp.findUnique({ where: { id }, include: this.followUpInclude });
    if (!f) throw notFound('Follow-up');
    if (!this.followUpDto(user, f).canEdit) throw forbidden('Only the person it’s assigned to, who created it, or a Super Admin can update it');
    if (dto.assignedToId !== undefined) await this.checkAssignee(dto.assignedToId);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.note?.trim() || dto.status) await tx.followUpNote.create({ data: { followUpId: id, authorId: user.id, status: dto.status ?? null, text: dto.note?.trim() || 'Status updated' } });
      return tx.followUp.update({
        where: { id },
        data: {
          status: dto.status,
          closedAt: dto.status === undefined ? undefined : dto.status === 'DONE' ? new Date() : null,
          assignedToId: dto.assignedToId,
          dueOn: dto.dueOn === undefined ? undefined : dto.dueOn ? toDateOnly(dto.dueOn) : null,
        },
        include: this.followUpInclude,
      });
    });
    if (dto.assignedToId && dto.assignedToId !== f.assignedToId) await this.notifyAssignee(user, dto.assignedToId, (f.member?.fullName ?? f.guest?.fullName) || 'someone', f.reason);
    await this.audit.record({ actorId: user.id, action: 'FOLLOW_UP_UPDATED', entityType: 'MEMBER', entityId: f.memberId, metadata: { status: dto.status ?? null }, meta });
    return this.followUpDto(user, updated);
  }

  // ================================================================ bacenta rosters

  private async bacentaFor(user: AuthUser, groupId: string, manage: boolean) {
    const g = await this.prisma.churchGroup.findUnique({ where: { id: groupId }, select: { id: true, type: true, name: true, ...groupRef } });
    if (!g) throw notFound('Group');
    if (g.type !== 'BACENTA') throw badRequest('INVALID', 'Rotas are for bacentas');
    const can = this.policy.canManageGroup(user, ref(g));
    if (manage && !can) throw forbidden('Only this bacenta’s leaders or a Super Admin can change its rota');
    if (!manage && !can && !this.policy.canViewMembership(user)) throw forbidden();
    return g;
  }

  private rosterDto(r: Prisma.RosterSlotGetPayload<{ include: { role: { select: { id: true; name: true } }; member: { select: { id: true; fullName: true; phone: true } } } }>): RosterSlotDto {
    return { id: r.id, date: fromDateOnly(r.date)!, service: r.service, role: r.role, member: r.member, note: r.note };
  }

  async roster(user: AuthUser, groupId: string, q: { from?: string; to?: string }): Promise<RosterSlotDto[]> {
    await this.bacentaFor(user, groupId, false);
    const from = q.from ?? today();
    const to = q.to ?? new Date(Date.parse(from) + 56 * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.prisma.rosterSlot.findMany({
      where: { groupId, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
      include: { role: { select: { id: true, name: true } }, member: { select: { id: true, fullName: true, phone: true } } },
      orderBy: [{ date: 'asc' }, { service: 'asc' }, { role: { sortOrder: 'asc' } }],
    });
    return rows.map((r) => this.rosterDto(r));
  }

  async addRoster(user: AuthUser, groupId: string, dto: { date: string; service?: string | null; roleId?: string | null; memberIds: string[]; note?: string | null }, meta: ReqMeta) {
    const g = await this.bacentaFor(user, groupId, true);
    if (dto.date < today()) throw badRequest('PAST_DATE', 'Choose today or a future date');
    if (dto.roleId && !(await this.prisma.bacentaRole.count({ where: { id: dto.roleId, groupId } }))) throw badRequest('ROLE', 'That team isn’t in this bacenta');
    const inIt = new Set((await this.prisma.memberBacenta.findMany({ where: { groupId, memberId: { in: dto.memberIds } }, select: { memberId: true } })).map((x) => x.memberId));
    const outside = dto.memberIds.filter((m) => !inIt.has(m));
    if (outside.length) throw badRequest('NOT_IN_BACENTA', `Only members of ${g.name} can be on its rota`);
    const date = toDateOnly(dto.date);
    const already = new Set(
      (await this.prisma.rosterSlot.findMany({ where: { groupId, date, roleId: dto.roleId ?? null, service: blank(dto.service) ?? null, memberId: { in: dto.memberIds } }, select: { memberId: true } })).map((x) => x.memberId),
    );
    const add = dto.memberIds.filter((m) => !already.has(m));
    if (add.length)
      await this.prisma.rosterSlot.createMany({
        data: add.map((memberId) => ({ groupId, date, service: blank(dto.service) ?? null, roleId: dto.roleId ?? null, memberId, note: blank(dto.note) ?? null, createdById: user.id })),
      });
    await this.audit.record({ actorId: user.id, action: 'ROSTER_UPDATED', entityType: 'GROUP', entityId: groupId, metadata: { date: dto.date, added: add.length }, meta });
    return this.roster(user, groupId, { from: dto.date, to: dto.date });
  }

  async removeRoster(user: AuthUser, groupId: string, slotId: string, meta: ReqMeta) {
    await this.bacentaFor(user, groupId, true);
    await this.prisma.rosterSlot.deleteMany({ where: { id: slotId, groupId } });
    await this.audit.record({ actorId: user.id, action: 'ROSTER_REMOVED', entityType: 'GROUP', entityId: groupId, metadata: { slotId }, meta });
  }

  // ================================================================ events & RSVPs

  private eventInclude = { group: { select: { id: true, name: true, ...groupRef } }, rsvps: { select: { userId: true, status: true, guests: true } } } satisfies Prisma.ChurchEventInclude;

  private eventDto(user: AuthUser, e: Prisma.ChurchEventGetPayload<{ include: ChurchService['eventInclude'] }>): ChurchEventDto {
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
      canEdit: this.policy.isMembershipAdmin(user) || (!!e.group && this.policy.canManageGroup(user, ref(e.group))) || e.createdById === user.id,
    };
  }

  /** Church-wide events are for everyone; group events for that group's people and admins. */
  private async eventScope(user: AuthUser): Promise<Prisma.ChurchEventWhereInput> {
    if (this.policy.isMembershipAdmin(user) || this.policy.canViewChurchStats(user)) return {};
    return { OR: [{ groupId: null }, { groupId: { in: await this.audience.groupsOfUser(user.id) } }] };
  }

  async events(user: AuthUser, q: { when?: 'upcoming' | 'past'; cursor?: string; limit?: number }): Promise<Page<ChurchEventDto>> {
    const take = pageSize(q.limit);
    const now = new Date();
    const past = q.when === 'past';
    const rows = await this.prisma.churchEvent.findMany({
      where: { AND: [await this.eventScope(user), past ? { OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }] } : { OR: [{ endsAt: { gte: now } }, { startsAt: { gte: now } }] }] },
      include: this.eventInclude,
      orderBy: [{ startsAt: past ? 'desc' : 'asc' }, { id: 'asc' }],
      ...cursorArgs(q.cursor, take),
    });
    const { items, nextCursor } = pageOf(rows, take);
    return { items: items.map((e) => this.eventDto(user, e)), nextCursor };
  }

  private async checkEventGroup(user: AuthUser, groupId: string | null | undefined) {
    if (!groupId) {
      if (!this.policy.isMembershipAdmin(user)) throw forbidden('Only a Super Admin can add church-wide events');
      return;
    }
    const g = await this.prisma.churchGroup.findUnique({ where: { id: groupId }, select: groupRef });
    if (!g) throw notFound('Group');
    if (!this.policy.canManageGroup(user, ref(g))) throw forbidden('You can only add events for groups you lead');
  }

  async createEvent(user: AuthUser, dto: { title: string; description?: string | null; location?: string | null; startsAt: string; endsAt?: string | null; groupId?: string | null; rsvpEnabled?: boolean; capacity?: number | null }, meta: ReqMeta) {
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
    await this.audit.record({ actorId: user.id, action: 'CHURCH_EVENT_CREATED', entityType: 'GROUP', entityId: dto.groupId ?? null, metadata: { title: e.title }, meta });
    return this.eventDto(user, e);
  }

  private async loadEvent(user: AuthUser, id: string, edit: boolean) {
    const e = await this.prisma.churchEvent.findFirst({ where: { AND: [{ id }, await this.eventScope(user)] }, include: this.eventInclude });
    if (!e) throw notFound('Event');
    if (edit && !this.eventDto(user, e).canEdit) throw forbidden();
    return e;
  }

  async updateEvent(user: AuthUser, id: string, dto: { title?: string; description?: string | null; location?: string | null; startsAt?: string; endsAt?: string | null; rsvpEnabled?: boolean; capacity?: number | null }, meta: ReqMeta) {
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
    await this.audit.record({ actorId: user.id, action: 'CHURCH_EVENT_UPDATED', entityType: 'GROUP', entityId: e.groupId, metadata: { title: e.title }, meta });
    return this.eventDto(user, e);
  }

  async deleteEvent(user: AuthUser, id: string, meta: ReqMeta) {
    const e = await this.loadEvent(user, id, true);
    await this.prisma.churchEvent.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'CHURCH_EVENT_DELETED', entityType: 'GROUP', entityId: e.groupId, metadata: { title: e.title }, meta });
  }

  async rsvp(user: AuthUser, id: string, dto: { status: RsvpStatus; guests?: number }) {
    const e = await this.loadEvent(user, id, false);
    if (!e.rsvpEnabled) throw badRequest('NO_RSVP', 'This event doesn’t take RSVPs');
    if ((e.endsAt ?? e.startsAt) < new Date()) throw badRequest('PAST', 'This event has already happened');
    const guests = dto.status === 'GOING' ? Math.max(0, Math.min(20, dto.guests ?? 0)) : 0;
    if (dto.status === 'GOING' && e.capacity) {
      const taken = e.rsvps.filter((r) => r.status === 'GOING' && r.userId !== user.id).reduce((a, r) => a + 1 + r.guests, 0);
      if (taken + 1 + guests > e.capacity) throw badRequest('FULL', `Sorry, it’s full (${e.capacity} places)`);
    }
    await this.prisma.eventRsvp.upsert({ where: { eventId_userId: { eventId: id, userId: user.id } }, create: { eventId: id, userId: user.id, status: dto.status, guests }, update: { status: dto.status, guests } });
    return this.eventDto(user, await this.loadEvent(user, id, false));
  }

  // ================================================================ milestones

  async memberAccess(user: AuthUser, memberId: string, edit: boolean) {
    const own = (await this.prisma.user.findUnique({ where: { id: user.id }, select: { memberId: true } }))?.memberId === memberId;
    if (edit) {
      const m = await this.membership.getMember(user, memberId).catch(() => null);
      if (!m?.canEdit) throw forbidden('Only the leaders of this member’s groups or a Super Admin can change this');
    } else if (!own && !this.policy.canViewMembership(user)) throw forbidden();
  }

  // ================================================================ households (check-in)

  async household(user: AuthUser, memberId: string) {
    await this.memberAccess(user, memberId, false);
    const m = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { guardian: { select: { id: true, fullName: true, phone: true } }, dependants: { select: { id: true, fullName: true, phone: true }, orderBy: { fullName: 'asc' } } },
    });
    if (!m) throw notFound('Member');
    return { guardian: m.guardian, dependants: m.dependants };
  }

  /** "Checks in with": a parent/relative who checks this member in at the QR code. */
  async setGuardian(user: AuthUser, memberId: string, guardianId: string | null, meta: ReqMeta) {
    await this.memberAccess(user, memberId, true);
    if (guardianId) {
      if (guardianId === memberId) throw badRequest('GUARDIAN', 'Someone can’t check themselves in');
      const g = await this.prisma.member.findUnique({ where: { id: guardianId }, select: { guardianId: true, isActive: true } });
      if (!g?.isActive) throw badRequest('GUARDIAN', 'Choose an active member');
      if (g.guardianId === memberId) throw badRequest('GUARDIAN', 'They already check in with this member');
    }
    await this.prisma.member.update({ where: { id: memberId }, data: { guardianId } });
    await this.audit.record({ actorId: user.id, action: 'MEMBER_GUARDIAN_SET', entityType: 'MEMBER', entityId: memberId, metadata: { guardianId }, meta });
    return this.household(user, memberId);
  }

  async milestones(user: AuthUser, memberId: string): Promise<MilestoneDto[]> {
    await this.memberAccess(user, memberId, false);
    const rows = await this.prisma.milestone.findMany({ where: { memberId }, orderBy: { date: 'desc' } });
    return rows.map((r) => ({ id: r.id, type: r.type, date: fromDateOnly(r.date)!, note: r.note }));
  }

  async addMilestone(user: AuthUser, memberId: string, dto: { type: string; date: string; note?: string | null }, meta: ReqMeta) {
    await this.memberAccess(user, memberId, true);
    if (dto.date > today()) throw badRequest('FUTURE_DATE', 'A milestone can’t be in the future');
    await this.prisma.milestone.create({ data: { memberId, type: dto.type.trim(), date: toDateOnly(dto.date), note: blank(dto.note) ?? null, createdById: user.id } });
    await this.audit.record({ actorId: user.id, action: 'MILESTONE_ADDED', entityType: 'MEMBER', entityId: memberId, metadata: { type: dto.type, date: dto.date }, meta });
    return this.milestones(user, memberId);
  }

  async removeMilestone(user: AuthUser, memberId: string, id: string, meta: ReqMeta) {
    await this.memberAccess(user, memberId, true);
    await this.prisma.milestone.deleteMany({ where: { id, memberId } });
    await this.audit.record({ actorId: user.id, action: 'MILESTONE_REMOVED', entityType: 'MEMBER', entityId: memberId, meta });
  }

  // ================================================================ announcements

  private annInclude = {
    groups: { include: { group: { select: { id: true, name: true } } } },
    createdBy: { select: { fullName: true } },
    _count: { select: { reads: true } },
  } satisfies Prisma.AnnouncementInclude;

  /** Announcements this user should see. */
  private async annScope(user: AuthUser): Promise<Prisma.AnnouncementWhereInput> {
    if (this.policy.isMembershipAdmin(user)) return {};
    const groups = await this.audience.groupsOfUser(user.id);
    return {
      OR: [
        { audience: 'CHURCH' },
        ...(isLeaderRole(user.role) ? [{ audience: 'LEADERS' as const }] : []),
        { audience: 'GROUPS', groups: { some: { groupId: { in: groups } } } },
        { createdById: user.id },
      ],
    };
  }

  private async audienceUsers(audience: AnnouncementAudience, groupIds: string[]): Promise<string[]> {
    return audience === 'CHURCH' ? this.audience.everyone() : audience === 'LEADERS' ? this.audience.allLeaders() : this.audience.usersInGroups(groupIds);
  }

  private async annDto(user: AuthUser, a: Prisma.AnnouncementGetPayload<{ include: ChurchService['annInclude'] }>, read: boolean, withSeen = false): Promise<AnnouncementDto> {
    const canEdit = this.policy.isMembershipAdmin(user) || a.createdById === user.id;
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      linkUrl: a.linkUrl,
      audience: a.audience,
      groups: a.groups.map((g) => g.group),
      pinned: a.pinned,
      publishAt: a.publishAt.toISOString(),
      expiresAt: a.expiresAt?.toISOString() ?? null,
      createdBy: a.createdBy?.fullName ?? null,
      read,
      seen: canEdit && withSeen ? { by: a._count.reads, of: (await this.audienceUsers(a.audience, a.groups.map((g) => g.groupId))).length } : null,
      canEdit,
    };
  }

  /** The feed: live announcements (pinned first, newest first). `manage`: also scheduled/expired ones you can edit. */
  async announcements(user: AuthUser, q: { manage?: boolean; cursor?: string; limit?: number }): Promise<Page<AnnouncementDto> & { unread: number }> {
    const now = new Date();
    const live: Prisma.AnnouncementWhereInput = { publishAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    const scope = await this.annScope(user);
    const where: Prisma.AnnouncementWhereInput = q.manage ? { AND: [scope, this.policy.isMembershipAdmin(user) ? {} : { createdById: user.id }] } : { AND: [scope, live] };
    const take = pageSize(q.limit);
    const [rows, unread] = await Promise.all([
      this.prisma.announcement.findMany({ where, include: this.annInclude, orderBy: q.manage ? [{ publishAt: 'desc' }, { id: 'asc' }] : [{ pinned: 'desc' }, { publishAt: 'desc' }, { id: 'asc' }], ...cursorArgs(q.cursor, take) }),
      this.prisma.announcement.count({ where: { AND: [scope, live, { reads: { none: { userId: user.id } } }] } }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    const reads = new Set((await this.prisma.announcementRead.findMany({ where: { userId: user.id, announcementId: { in: items.map((i) => i.id) } }, select: { announcementId: true } })).map((r) => r.announcementId));
    return { items: await Promise.all(items.map((a) => this.annDto(user, a, reads.has(a.id), !!q.manage))), nextCursor, unread };
  }

  private async checkAnnAudience(user: AuthUser, audience: AnnouncementAudience, groupIds: string[]) {
    if (audience !== 'GROUPS') {
      if (!this.policy.isMembershipAdmin(user)) throw forbidden('Only a Super Admin can announce to the whole church or all leaders');
      return;
    }
    if (!groupIds.length) throw badRequest('GROUPS', 'Choose at least one group');
    const gs = await this.prisma.churchGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, ...groupRef } });
    if (gs.length !== new Set(groupIds).size) throw badRequest('GROUPS', 'Unknown group');
    if (!this.policy.isMembershipAdmin(user) && gs.some((g) => !this.policy.canAdministerGroup(user, ref(g)))) throw forbidden('You can only announce to groups you lead');
  }

  async createAnnouncement(
    user: AuthUser,
    dto: { title: string; body: string; linkUrl?: string | null; audience: AnnouncementAudience; groupIds?: string[]; pinned?: boolean; publishAt?: string | null; expiresAt?: string | null },
    meta: ReqMeta,
  ) {
    const groupIds = [...new Set(dto.groupIds ?? [])];
    await this.checkAnnAudience(user, dto.audience, groupIds);
    const publishAt = dto.publishAt ? new Date(dto.publishAt) : new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= publishAt) throw badRequest('DATES', 'It must end after it starts');
    const a = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        linkUrl: blank(dto.linkUrl) ?? null,
        audience: dto.audience,
        pinned: !!dto.pinned && this.policy.isMembershipAdmin(user),
        publishAt,
        expiresAt,
        createdById: user.id,
        groups: dto.audience === 'GROUPS' ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
      },
      include: this.annInclude,
    });
    if (publishAt <= new Date()) await this.sendAnnouncement(a.id);
    await this.audit.record({ actorId: user.id, action: 'ANNOUNCEMENT_CREATED', entityType: 'SETTINGS', entityId: a.id, metadata: { title: a.title, audience: a.audience, groups: groupIds.length }, meta });
    return this.annDto(user, a, false, true);
  }

  /** Push the announcement to its audience once (scheduled ones: the worker calls the same). */
  async sendAnnouncement(id: string): Promise<number> {
    const claimed = await this.prisma.announcement.updateMany({ where: { id, notifiedAt: null, publishAt: { lte: new Date() } }, data: { notifiedAt: new Date() } });
    if (!claimed.count) return 0;
    const a = await this.prisma.announcement.findUniqueOrThrow({ where: { id }, include: { groups: true } });
    const userIds = await this.audienceUsers(a.audience, a.groups.map((g) => g.groupId));
    const body = a.body.length > 160 ? `${a.body.slice(0, 157)}…` : a.body;
    await this.queue.push({ userIds, kind: 'announcement', payload: { title: a.title, body, url: '/announcements', tag: `ann-${a.id}`.slice(0, 32) } });
    return userIds.length;
  }

  async updateAnnouncement(user: AuthUser, id: string, dto: { title?: string; body?: string; linkUrl?: string | null; pinned?: boolean; expiresAt?: string | null }, meta: ReqMeta) {
    const a = await this.prisma.announcement.findUnique({ where: { id }, include: this.annInclude });
    if (!a) throw notFound('Announcement');
    if (!this.policy.isMembershipAdmin(user) && a.createdById !== user.id) throw forbidden();
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title?.trim() || undefined,
        body: dto.body?.trim() || undefined,
        linkUrl: blank(dto.linkUrl),
        pinned: dto.pinned === undefined ? undefined : !!dto.pinned && this.policy.isMembershipAdmin(user),
        expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: this.annInclude,
    });
    await this.audit.record({ actorId: user.id, action: 'ANNOUNCEMENT_UPDATED', entityType: 'SETTINGS', entityId: id, meta });
    return this.annDto(user, updated, false, true);
  }

  async deleteAnnouncement(user: AuthUser, id: string, meta: ReqMeta) {
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a) throw notFound('Announcement');
    if (!this.policy.isMembershipAdmin(user) && a.createdById !== user.id) throw forbidden();
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'ANNOUNCEMENT_DELETED', entityType: 'SETTINGS', entityId: id, metadata: { title: a.title }, meta });
  }

  async markRead(user: AuthUser, id: string) {
    const a = await this.prisma.announcement.findFirst({ where: { AND: [{ id }, await this.annScope(user)] }, select: { id: true } });
    if (!a) throw notFound('Announcement');
    await this.prisma.announcementRead.upsert({ where: { announcementId_userId: { announcementId: id, userId: user.id } }, create: { announcementId: id, userId: user.id }, update: {} });
  }

  // ================================================================ visitor cards (public)

  /** A visitor fills in their own card (QR code at the service). Lands in "New people". */
  async visitorCard(dto: { fullName: string; phone?: string | null; location?: string | null; howHeard?: string | null; prayerRequest?: string | null; wantsToJoin?: boolean; website?: string }) {
    if (dto.website) return { ok: true }; // honeypot: bots fill every field
    const phone = tenDigitPhone(dto.phone);
    if (dto.phone?.trim() && !phone) throw badRequest('PHONE', 'Enter a 10-digit phone number, e.g. 0241234567');
    // The same person submitting twice on one day counts once.
    if (phone) {
      const dup = await this.prisma.guest.findFirst({ where: { sessionId: null, phone, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, select: { id: true } });
      if (dup) return { ok: true };
    }
    await this.prisma.guest.create({
      data: {
        sessionId: null,
        fullName: dto.fullName.trim(),
        phone,
        location: blank(dto.location) ?? null,
        howHeard: blank(dto.howHeard) ?? null,
        prayerRequest: blank(dto.prayerRequest) ?? null,
        intent: dto.wantsToJoin ? 'JOINING' : 'VISIT',
      },
    });
    return { ok: true };
  }

  /** The QR code for the visitor card (print it, or show it on the screen at church). */
  async visitorCardQr(user: AuthUser) {
    this.leader(user);
    const url = `${this.env.WEB_ORIGIN}/welcome`;
    return { url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 600 }) };
  }

  /** Visitor cards filled in recently (all of them, not just "wants to join"). */
  async visitorCards(user: AuthUser, q: { cursor?: string; limit?: number }) {
    this.leader(user);
    const take = pageSize(q.limit);
    const where: Prisma.GuestWhereInput = { sessionId: null };
    const [rows, total] = await Promise.all([
      this.prisma.guest.findMany({ where, include: { convertedMember: { select: { id: true, fullName: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...cursorArgs(q.cursor, take) }),
      this.prisma.guest.count({ where }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    return {
      items: items.map((g) => ({
        id: g.id,
        fullName: g.fullName,
        phone: g.phone,
        intent: g.intent,
        broughtBy: null,
        convertedMember: g.convertedMember,
        fromCard: true,
        location: g.location,
        howHeard: g.howHeard,
        prayerRequest: g.prayerRequest,
        createdAt: g.createdAt.toISOString(),
      })),
      nextCursor,
      total,
    };
  }

  // ================================================================ import members

  /**
   * Imports members from a spreadsheet (already parsed by the browser). `dryRun` checks every
   * row and reports what would happen; otherwise creates the valid, non-duplicate rows.
   */
  async importMembers(user: AuthUser, rows: ImportRow[], dryRun: boolean, meta: ReqMeta) {
    this.leader(user);
    if (rows.length > 2000) throw badRequest('TOO_MANY', 'Import at most 2,000 rows at a time');
    const groups = await this.prisma.churchGroup.findMany({ select: { id: true, name: true, type: true, parentId: true } });
    const find = (type: string, name: string | null | undefined) => (name?.trim() ? groups.find((g) => g.type === type && g.name.toLowerCase() === name.trim().toLowerCase()) : undefined);
    const existingPhones = new Set((await this.prisma.member.findMany({ where: { phone: { not: null } }, select: { phone: true } })).map((m) => normalizePhone(m.phone)).filter(Boolean));
    const seen = new Set<string>();
    const date = (v: string | null | undefined): Date | null | 'bad' => {
      if (!v?.trim()) return null;
      const s = v.trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.test(s) ? s.replace(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/, (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`) : null;
      return iso && !Number.isNaN(Date.parse(iso)) && iso <= today() ? toDateOnly(iso) : 'bad';
    };
    const results: ImportRowResult[] = [];
    const toCreate: Array<{ data: Prisma.MemberUncheckedCreateInput; bacentaIds: string[] }> = [];
    rows.forEach((r, i) => {
      const row = i + 2; // header is row 1
      const fullName = (r.fullName ?? '').trim();
      const fail = (message: string) => results.push({ row, fullName: fullName || '(no name)', status: 'error', message });
      if (fullName.length < 2) return fail('Name is missing');
      const phone = normalizePhone(r.phone);
      if (r.phone?.trim() && !phone) return fail(`Phone “${r.phone}” doesn’t look right`);
      if (phone && (existingPhones.has(phone) || seen.has(phone))) return results.push({ row, fullName, status: 'duplicate', message: `${phone} is already ${seen.has(phone) ? 'earlier in this file' : 'a member'}` });
      const email = r.email?.trim() || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(`Email “${email}” doesn’t look right`);
      const dob = date(r.dateOfBirth);
      if (dob === 'bad') return fail(`Date of birth “${r.dateOfBirth}” isn’t a date (use YYYY-MM-DD or DD/MM/YYYY)`);
      const joined = date(r.joinedOn);
      if (joined === 'bad') return fail(`Joined date “${r.joinedOn}” isn’t a date`);
      const basonta = find('BASONTA', r.basonta);
      if (r.basonta?.trim() && !basonta) return fail(`No basonta called “${r.basonta}”`);
      let constituency = find('CONSTITUENCY', r.constituency);
      if (r.constituency?.trim() && !constituency) return fail(`No constituency called “${r.constituency}”`);
      if (basonta?.parentId) {
        if (constituency && constituency.id !== basonta.parentId) return fail(`${basonta.name} isn’t in ${constituency.name}`);
        constituency = groups.find((g) => g.id === basonta.parentId);
      }
      const bacentaNames = (r.bacentas ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean);
      const bacentas = bacentaNames.map((n) => find('BACENTA', n));
      const missing = bacentaNames.filter((_, k) => !bacentas[k]);
      if (missing.length) return fail(`No bacenta called “${missing[0]}”`);
      const gender = r.gender?.trim() ? (/^f/i.test(r.gender) ? 'Female' : /^m/i.test(r.gender) ? 'Male' : null) : null;
      if (phone) seen.add(phone);
      results.push({ row, fullName, status: 'create', message: null });
      toCreate.push({
        data: {
          fullName,
          phone,
          email,
          gender,
          dateOfBirth: dob,
          joinedOn: joined,
          location: r.location?.trim() || null,
          churchRole: r.churchRole?.trim() || 'Member',
          constituencyId: constituency?.id ?? null,
          basontaId: basonta?.id ?? null,
          createdById: user.id,
        },
        bacentaIds: [...new Set(bacentas.map((b) => b!.id))],
      });
    });
    const summary = { create: toCreate.length, duplicate: results.filter((r) => r.status === 'duplicate').length, error: results.filter((r) => r.status === 'error').length };
    if (!dryRun && toCreate.length) {
      for (let i = 0; i < toCreate.length; i += 200) {
        await this.prisma.$transaction(async (tx) => {
          for (const c of toCreate.slice(i, i + 200)) {
            const m = await tx.member.create({ data: c.data });
            if (c.bacentaIds.length) await tx.memberBacenta.createMany({ data: c.bacentaIds.map((groupId) => ({ memberId: m.id, groupId })) });
          }
        });
      }
      await this.audit.record({ actorId: user.id, action: 'MEMBERS_IMPORTED', entityType: 'MEMBER', metadata: summary, meta });
    }
    return { dryRun, summary, results: results.filter((r) => r.status !== 'create' || dryRun).slice(0, 2000) };
  }

  // ================================================================ my church (member accounts)

  private async myMemberId(user: AuthUser) {
    return (await this.prisma.user.findUnique({ where: { id: user.id }, select: { memberId: true } }))?.memberId ?? null;
  }

  async myChurch(user: AuthUser): Promise<MyChurchDto> {
    const memberId = await this.myMemberId(user);
    if (!memberId) return { member: null, leaders: [], attendance: [], birthdays: [], roster: [] };
    const m = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { constituencyId: true, basontaId: true, bacentas: { select: { groupId: true } } },
    });
    const groupIds = [m.basontaId, m.constituencyId, ...m.bacentas.map((b) => b.groupId)].filter((g): g is string => !!g);
    const [member, groups, attendance, roster] = await Promise.all([
      this.membership.memberForSelf(memberId, user),
      this.prisma.churchGroup.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true, type: true, pastor: { select: pastorSelect }, shepherds: { select: { user: { select: pastorSelect } } } },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { memberId },
        include: { session: { select: { date: true, serviceType: true, title: true, group: { select: { name: true } } } } },
        orderBy: { session: { date: 'desc' } },
        take: 12,
      }),
      this.prisma.rosterSlot.findMany({
        where: { memberId, date: { gte: toDateOnly(today()) } },
        include: { role: { select: { id: true, name: true } }, member: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { date: 'asc' },
        take: 10,
      }),
    ]);
    const birthdays = (await Promise.all(groups.map(async (g) => (await this.membership.upcomingBirthdays(user, g.id, 14, true)).map((b) => ({ ...b, group: g.name, phone: null })))))
      .flat()
      .filter((b, i, all) => b.id !== memberId && all.findIndex((x) => x.id === b.id) === i)
      .sort((a, b) => a.daysAway - b.daysAway)
      .slice(0, 10);
    return {
      member,
      leaders: groups.map((g) => ({ group: { id: g.id, name: g.name, type: g.type }, pastor: g.pastor as PastorDto | null, shepherds: g.shepherds.map((s) => s.user as PastorDto) })),
      attendance: attendance.map((a) => ({ date: fromDateOnly(a.session.date)!, name: [a.session.group?.name, a.session.serviceType, a.session.title].filter(Boolean).join(' · ') })),
      birthdays,
      roster: roster.map((r) => this.rosterDto(r)),
    };
  }

  /** Members update their own contact details and birthday. */
  async updateMyMember(user: AuthUser, dto: { phone?: string | null; location?: string | null; dateOfBirth?: string | null; email?: string | null }, meta: ReqMeta) {
    const memberId = await this.myMemberId(user);
    if (!memberId) throw badRequest('NOT_LINKED', 'Your account isn’t linked to a member record yet. Ask a pastor.');
    const phone = dto.phone === undefined ? undefined : tenDigitPhone(dto.phone);
    if (dto.phone && !phone) throw badRequest('PHONE', 'Enter a 10-digit phone number, e.g. 0241234567');
    if (phone) {
      const dup = await this.prisma.member.findFirst({ where: { phone, id: { not: memberId } }, select: { id: true } });
      if (dup) throw conflict('MEMBER_EXISTS', 'Another member already has that phone number');
    }
    if (dto.dateOfBirth && dto.dateOfBirth > today()) throw badRequest('DATE', 'Choose a date in the past');
    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        phone,
        location: blank(dto.location),
        email: dto.email === undefined ? undefined : dto.email?.trim().toLowerCase() || null,
        dateOfBirth: dto.dateOfBirth === undefined ? undefined : dto.dateOfBirth ? toDateOnly(dto.dateOfBirth) : null,
      },
    });
    await this.audit.record({ actorId: user.id, action: 'MEMBER_SELF_UPDATED', entityType: 'MEMBER', entityId: memberId, metadata: { fields: Object.keys(dto) }, meta });
    return this.myChurch(user);
  }
}
