import { Injectable } from '@nestjs/common';
import { Prisma, type AnnouncementAudience } from '@wcc/db';
import type { AnnouncementDto, Page } from '@wcc/shared';
import { badRequest, forbidden, notFound } from '../common/errors';
import { cursorArgs, pageOf, pageSize } from '../common/pagination';
import { blank, isLeaderRole, groupRef, ref } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AudienceService } from './audience.service';

/** Announcements: audience, scheduling, push and read receipts. */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly audience: AudienceService,
  ) {}

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
    return audience === 'CHURCH'
      ? this.audience.everyone()
      : audience === 'LEADERS'
        ? this.audience.allLeaders()
        : this.audience.usersInGroups(groupIds);
  }

  /**
   * Audience sizes for "seen by X of Y", computed once per distinct audience on a page
   * (several announcements to the whole church share one count).
   */
  private audienceCounter() {
    const memo = new Map<string, Promise<number>>();
    return (audience: AnnouncementAudience, groupIds: string[]) => {
      const key = `${audience}:${[...groupIds].sort().join(',')}`;
      if (!memo.has(key))
        memo.set(
          key,
          this.audienceUsers(audience, groupIds).then((u) => u.length),
        );
      return memo.get(key)!;
    };
  }

  private async annDto(
    user: AuthUser,
    a: Prisma.AnnouncementGetPayload<{ include: AnnouncementsService['annInclude'] }>,
    read: boolean,
    withSeen = false,
    count = this.audienceCounter(),
  ): Promise<AnnouncementDto> {
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
      seen:
        canEdit && withSeen
          ? {
              by: a._count.reads,
              of: await count(
                a.audience,
                a.groups.map((g) => g.groupId),
              ),
            }
          : null,
      canEdit,
    };
  }

  /** The feed: live announcements (pinned first, newest first). `manage`: also scheduled/expired ones you can edit. */
  async announcements(
    user: AuthUser,
    q: { manage?: boolean; cursor?: string; limit?: number },
  ): Promise<Page<AnnouncementDto> & { unread: number }> {
    const now = new Date();
    const live: Prisma.AnnouncementWhereInput = {
      publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const scope = await this.annScope(user);
    const where: Prisma.AnnouncementWhereInput = q.manage
      ? { AND: [scope, this.policy.isMembershipAdmin(user) ? {} : { createdById: user.id }] }
      : { AND: [scope, live] };
    const take = pageSize(q.limit);
    const [rows, unread] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        include: this.annInclude,
        orderBy: q.manage
          ? [{ publishAt: 'desc' }, { id: 'asc' }]
          : [{ pinned: 'desc' }, { publishAt: 'desc' }, { id: 'asc' }],
        ...cursorArgs(q.cursor, take),
      }),
      this.prisma.announcement.count({
        where: { AND: [scope, live, { reads: { none: { userId: user.id } } }] },
      }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    const reads = new Set(
      (
        await this.prisma.announcementRead.findMany({
          where: { userId: user.id, announcementId: { in: items.map((i) => i.id) } },
          select: { announcementId: true },
        })
      ).map((r) => r.announcementId),
    );
    const count = this.audienceCounter();
    return {
      items: await Promise.all(items.map((a) => this.annDto(user, a, reads.has(a.id), !!q.manage, count))),
      nextCursor,
      unread,
    };
  }

  private async checkAnnAudience(user: AuthUser, audience: AnnouncementAudience, groupIds: string[]) {
    if (audience !== 'GROUPS') {
      if (!this.policy.isMembershipAdmin(user))
        throw forbidden('Only a Super Admin can announce to the whole church or all leaders');
      return;
    }
    if (!groupIds.length) throw badRequest('GROUPS', 'Choose at least one group');
    const gs = await this.prisma.churchGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, ...groupRef },
    });
    if (gs.length !== new Set(groupIds).size) throw badRequest('GROUPS', 'Unknown group');
    if (!this.policy.isMembershipAdmin(user) && gs.some((g) => !this.policy.canAdministerGroup(user, ref(g))))
      throw forbidden('You can only announce to groups you lead');
  }

  async createAnnouncement(
    user: AuthUser,
    dto: {
      title: string;
      body: string;
      linkUrl?: string | null;
      audience: AnnouncementAudience;
      groupIds?: string[];
      pinned?: boolean;
      publishAt?: string | null;
      expiresAt?: string | null;
    },
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
    await this.audit.record({
      actorId: user.id,
      action: 'ANNOUNCEMENT_CREATED',
      entityType: 'SETTINGS',
      entityId: a.id,
      metadata: { title: a.title, audience: a.audience, groups: groupIds.length },
      meta,
    });
    return this.annDto(user, a, false, true);
  }

  /** Push the announcement to its audience once (scheduled ones: the worker calls the same). */
  async sendAnnouncement(id: string): Promise<number> {
    const claimed = await this.prisma.announcement.updateMany({
      where: { id, notifiedAt: null, publishAt: { lte: new Date() } },
      data: { notifiedAt: new Date() },
    });
    if (!claimed.count) return 0;
    const a = await this.prisma.announcement.findUniqueOrThrow({ where: { id }, include: { groups: true } });
    const userIds = await this.audienceUsers(
      a.audience,
      a.groups.map((g) => g.groupId),
    );
    const body = a.body.length > 160 ? `${a.body.slice(0, 157)}…` : a.body;
    await this.queue.push({
      userIds,
      kind: 'announcement',
      payload: { title: a.title, body, url: '/announcements', tag: `ann-${a.id}`.slice(0, 32) },
    });
    return userIds.length;
  }

  async updateAnnouncement(
    user: AuthUser,
    id: string,
    dto: {
      title?: string;
      body?: string;
      linkUrl?: string | null;
      pinned?: boolean;
      expiresAt?: string | null;
    },
    meta: ReqMeta,
  ) {
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
    await this.audit.record({
      actorId: user.id,
      action: 'ANNOUNCEMENT_UPDATED',
      entityType: 'SETTINGS',
      entityId: id,
      meta,
    });
    return this.annDto(user, updated, false, true);
  }

  async deleteAnnouncement(user: AuthUser, id: string, meta: ReqMeta) {
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a) throw notFound('Announcement');
    if (!this.policy.isMembershipAdmin(user) && a.createdById !== user.id) throw forbidden();
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'ANNOUNCEMENT_DELETED',
      entityType: 'SETTINGS',
      entityId: id,
      metadata: { title: a.title },
      meta,
    });
  }

  async markRead(user: AuthUser, id: string) {
    const a = await this.prisma.announcement.findFirst({
      where: { AND: [{ id }, await this.annScope(user)] },
      select: { id: true },
    });
    if (!a) throw notFound('Announcement');
    await this.prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId: user.id } },
      create: { announcementId: id, userId: user.id },
      update: {},
    });
  }
}
