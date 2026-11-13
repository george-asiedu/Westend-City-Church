import { Injectable } from '@nestjs/common';
import { Prisma, type FollowUpStatus } from '@wcc/db';
import type { FollowUpDto, Page, PastorDto } from '@wcc/shared';
import { badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, fromDateOnly, pageOf, pageSize, toDateOnly } from '../common/pagination';
import { pastorSelect, conflict, today, isLeaderRole } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { ChurchAccess } from './shared';

/** People to call or visit, with notes and assignment. */
@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly access: ChurchAccess,
  ) {}

  private followUpInclude = {
    member: {
      select: {
        id: true,
        fullName: true,
        phone: true,
        basonta: { select: { name: true } },
        constituency: { select: { name: true } },
      },
    },
    guest: { select: { id: true, fullName: true, phone: true } },
    assignedTo: { select: { id: true, fullName: true } },
    createdBy: { select: { id: true, fullName: true } },
    notes: {
      include: { author: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' as const },
      take: 20,
    },
  } satisfies Prisma.FollowUpInclude;

  private followUpDto(
    user: AuthUser,
    f: Prisma.FollowUpGetPayload<{ include: FollowUpsService['followUpInclude'] }>,
  ): FollowUpDto {
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
        ? {
            kind: 'MEMBER',
            id: f.member.id,
            fullName: f.member.fullName,
            phone: f.member.phone,
            group: f.member.basonta?.name ?? f.member.constituency?.name ?? null,
          }
        : {
            kind: 'GUEST',
            id: f.guest!.id,
            fullName: f.guest!.fullName ?? 'Name not recorded',
            phone: f.guest!.phone,
            group: null,
          },
      assignedTo: f.assignedTo,
      createdBy: f.createdBy,
      notes: f.notes.map((n) => ({
        id: n.id,
        text: n.text,
        status: n.status,
        author: n.author?.fullName ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      canEdit: this.policy.isMembershipAdmin(user) || f.assignedToId === user.id || f.createdById === user.id,
    };
  }

  async followUps(
    user: AuthUser,
    q: { scope?: 'mine' | 'all'; state?: 'open' | 'closed'; cursor?: string; limit?: number },
  ): Promise<Page<FollowUpDto> & { total: number; overdue: number }> {
    this.access.leader(user);
    const scope: Prisma.FollowUpWhereInput =
      q.scope === 'all' && this.policy.isMembershipAdmin(user)
        ? {}
        : q.scope === 'all'
          ? { OR: [{ assignedToId: user.id }, { createdById: user.id }] }
          : { assignedToId: user.id };
    const where: Prisma.FollowUpWhereInput = {
      ...scope,
      status: q.state === 'closed' ? 'DONE' : { not: 'DONE' },
    };
    const take = pageSize(q.limit);
    const [rows, total, overdue] = await Promise.all([
      this.prisma.followUp.findMany({
        where,
        include: this.followUpInclude,
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }],
        ...cursorArgs(q.cursor, take),
      }),
      this.prisma.followUp.count({ where }),
      this.prisma.followUp.count({
        where: { ...scope, status: { not: 'DONE' }, dueOn: { lt: toDateOnly(today()) } },
      }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    return { items: items.map((f) => this.followUpDto(user, f)), nextCursor, total, overdue };
  }

  async assignees(user: AuthUser): Promise<PastorDto[]> {
    this.access.leader(user);
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD'] } },
      select: pastorSelect,
      orderBy: { fullName: 'asc' },
    });
  }

  async createFollowUp(
    user: AuthUser,
    dto: {
      memberId?: string;
      guestId?: string;
      reason: string;
      assignedToId?: string | null;
      dueOn?: string | null;
    },
    meta: ReqMeta,
  ) {
    this.access.leader(user);
    if (!dto.memberId === !dto.guestId) throw badRequest('INVALID', 'Choose one member or one new person');
    const existing = await this.prisma.followUp.findFirst({
      where: {
        memberId: dto.memberId ?? undefined,
        guestId: dto.guestId ?? undefined,
        status: { not: 'DONE' },
      },
      include: this.followUpInclude,
    });
    if (existing)
      throw conflict(
        'FOLLOW_UP_EXISTS',
        `There’s already an open follow-up for this person (assigned to ${existing.assignedTo?.fullName ?? 'nobody yet'})`,
      );
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
    await this.audit.record({
      actorId: user.id,
      action: 'FOLLOW_UP_CREATED',
      entityType: 'MEMBER',
      entityId: dto.memberId ?? null,
      metadata: { reason: f.reason, assignedTo: f.assignedToId },
      meta,
    });
    return this.followUpDto(user, f);
  }

  private async checkAssignee(id: string | null | undefined) {
    if (!id) return;
    const u = await this.prisma.user.findUnique({ where: { id }, select: { status: true, role: true } });
    if (!u || u.status !== 'ACTIVE' || !isLeaderRole(u.role))
      throw badRequest('ASSIGNEE', 'Assign it to an active pastor, shepherd or Super Admin');
  }

  private async notifyAssignee(user: AuthUser, assigneeId: string | null, name: string, reason: string) {
    if (!assigneeId || assigneeId === user.id) return;
    await this.queue.push({
      userIds: [assigneeId],
      kind: 'reminder',
      payload: {
        title: `Could you check on ${name}?`,
        body: `${user.fullName} asked if you could reach out. ${reason}`,
        url: '/church/follow-ups',
        tag: 'follow-up',
      },
    });
  }

  async updateFollowUp(
    user: AuthUser,
    id: string,
    dto: { status?: FollowUpStatus; note?: string; assignedToId?: string | null; dueOn?: string | null },
    meta: ReqMeta,
  ) {
    this.access.leader(user);
    const f = await this.prisma.followUp.findUnique({ where: { id }, include: this.followUpInclude });
    if (!f) throw notFound('Follow-up');
    if (!this.followUpDto(user, f).canEdit)
      throw forbidden('Only the person it’s assigned to, who created it, or a Super Admin can update it');
    if (dto.assignedToId !== undefined) await this.checkAssignee(dto.assignedToId);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.note?.trim() || dto.status)
        await tx.followUpNote.create({
          data: {
            followUpId: id,
            authorId: user.id,
            status: dto.status ?? null,
            text: dto.note?.trim() || 'Status updated',
          },
        });
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
    if (dto.assignedToId && dto.assignedToId !== f.assignedToId)
      await this.notifyAssignee(
        user,
        dto.assignedToId,
        (f.member?.fullName ?? f.guest?.fullName) || 'someone',
        f.reason,
      );
    await this.audit.record({
      actorId: user.id,
      action: 'FOLLOW_UP_UPDATED',
      entityType: 'MEMBER',
      entityId: f.memberId,
      metadata: { status: dto.status ?? null },
      meta,
    });
    return this.followUpDto(user, updated);
  }
}
