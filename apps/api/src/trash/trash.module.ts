import { Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { forbidden, notFound } from '../common/errors';
import { fromDateOnly } from '../common/pagination';

@Injectable()
export class TrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly delivery: DeliveryService,
  ) {}

  async list(user: AuthUser) {
    if (!this.policy.canViewTrash(user)) throw forbidden();
    const admin = this.policy.isAdmin(user);
    const events = await this.prisma.event.findMany({
      where: { deletedAt: { not: null }, ...(admin ? {} : { createdById: user.id }) },
      orderBy: { deletedAt: 'desc' },
      take: 200,
      include: { category: { select: { name: true } }, _count: { select: { media: { where: { deletedAt: { not: null } } } } } },
    });
    // Media deleted on its own (its event still alive); event-level deletions are listed under the event.
    const media = await this.prisma.mediaAsset.findMany({
      where: { deletedAt: { not: null }, event: { deletedAt: null }, ...(admin ? {} : { uploadedById: user.id }) },
      orderBy: { deletedAt: 'desc' },
      take: 500,
      include: { variants: { select: { kind: true, key: true } }, event: { select: { id: true, title: true } } },
    });
    const retention = await this.purgeAfterFor(events.map((e) => e.id));
    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        categoryName: e.category.name,
        eventDate: fromDateOnly(e.eventDate),
        mediaCount: e._count.media,
        deletedAt: e.deletedAt,
        purgeAfter: retention.get(e.id) ?? null,
      })),
      media: await Promise.all(
        media.map(async (m) => ({
          id: m.id,
          type: m.type,
          originalFilename: m.originalFilename,
          event: m.event,
          deletedAt: m.deletedAt,
          purgeAfter: m.purgeAfter,
          thumbUrl: (await this.delivery.mediaUrls({ type: m.type, originalKey: m.originalKey, variants: m.variants })).thumbUrl,
        })),
      ),
    };
  }

  private async purgeAfterFor(eventIds: string[]): Promise<Map<string, Date>> {
    if (!eventIds.length) return new Map();
    const rows = await this.prisma.mediaAsset.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds } }, _min: { purgeAfter: true } });
    return new Map(rows.filter((r) => r._min.purgeAfter).map((r) => [r.eventId, r._min.purgeAfter!]));
  }

  async purgeMedia(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    if (!this.policy.canPurge(user)) throw forbidden();
    const m = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!m || !m.deletedAt) throw notFound('Media');
    await this.queue.purgeMedia({ mediaId: id });
    await this.audit.record({ actorId: user.id, action: 'MEDIA_PURGE_REQUESTED', entityType: 'MEDIA', entityId: id, metadata: { filename: m.originalFilename }, meta });
  }

  async purgeEvent(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    if (!this.policy.canPurge(user)) throw forbidden();
    const e = await this.prisma.event.findUnique({ where: { id } });
    if (!e || !e.deletedAt) throw notFound('Event');
    const media = await this.prisma.mediaAsset.findMany({ where: { eventId: id }, select: { id: true } });
    if (!media.length) {
      await this.prisma.event.delete({ where: { id } }); // nothing in S3 to clean up
    } else {
      const now = new Date();
      await this.prisma.mediaAsset.updateMany({ where: { eventId: id }, data: { deletedAt: now, purgeAfter: now } });
      // The worker deletes the event row after purging its last media item.
      for (const m of media) await this.queue.purgeMedia({ mediaId: m.id });
    }
    await this.audit.record({ actorId: user.id, action: 'EVENT_PURGE_REQUESTED', entityType: 'EVENT', entityId: id, metadata: { title: e.title, media: media.length }, meta });
  }
}

@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.trash.list(user);
  }

  @Delete('media/:id')
  @HttpCode(204)
  async purgeMedia(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.trash.purgeMedia(user, id, meta);
  }

  @Delete('events/:id')
  @HttpCode(204)
  async purgeEvent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta) {
    await this.trash.purgeEvent(user, id, meta);
  }
}

@Module({ controllers: [TrashController], providers: [TrashService] })
export class TrashModule {}
