import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@wcc/db';
import { DEFAULT_LIMITS } from '@wcc/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { DeliveryService } from '../delivery/delivery.service';
import { EventsService } from '../events/events.service';
import { MEDIA_INCLUDE, MediaMapper } from './media-mapper.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { clampLimit } from '../common/pagination';
import { recountEvents } from '@wcc/db';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

export interface ListMediaQuery {
  type?: 'IMAGE' | 'VIDEO';
  status?: 'PENDING_UPLOAD' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';
  tag?: string;
  uploadedBy?: string;
  featured?: boolean;
  sort?: 'takenAt' | 'createdAt' | 'sortOrder';
  cursor?: string;
  limit?: number;
}

export type BulkAction = 'delete' | 'move' | 'tag' | 'untag' | 'feature' | 'unfeature';

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().replace(/\s+/g, ' ')).filter((t) => t.length > 0 && t.length <= 40))].slice(0, 30);
}

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly delivery: DeliveryService,
    private readonly events: EventsService,
    private readonly mapper: MediaMapper,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async listForEvent(user: AuthUser, eventId: string, q: ListMediaQuery) {
    await this.events.load(user, eventId);
    const limit = clampLimit(q.limit);
    const orderBy: Prisma.MediaAssetOrderByWithRelationInput[] =
      q.sort === 'createdAt'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : q.sort === 'sortOrder'
          ? [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
          : [{ takenAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }];
    const rows = await this.prisma.mediaAsset.findMany({
      where: {
        eventId,
        deletedAt: null,
        type: q.type,
        status: q.status,
        isFeatured: q.featured || undefined,
        uploadedById: q.uploadedBy,
        tags: q.tag ? { some: { tag: { name: { equals: q.tag, mode: 'insensitive' } } } } : undefined,
        // Unfinished uploads are visible only to the person uploading them.
        OR: [{ status: { not: 'PENDING_UPLOAD' } }, { uploadedById: user.id }],
      },
      include: MEDIA_INCLUDE,
      orderBy,
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: Buffer.from(q.cursor, 'base64url').toString() }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      items: await this.mapper.toDtos(page, user),
      nextCursor: rows.length > limit ? Buffer.from(page[page.length - 1]!.id).toString('base64url') : null,
    };
  }

  /** Loads a non-deleted media row the user can see, or 404. */
  async load(user: AuthUser, id: string, opts: { includeDeleted?: boolean } = {}) {
    const m = await this.prisma.mediaAsset.findUnique({ where: { id }, include: { ...MEDIA_INCLUDE, event: { select: { categoryId: true, createdById: true, status: true, deletedAt: true, title: true } } } });
    if (!m || (!opts.includeDeleted && (m.deletedAt || m.event.deletedAt))) throw notFound('Media');
    if (!this.policy.canViewEvent(user, m.event)) throw notFound('Media');
    if (m.status === 'PENDING_UPLOAD' && m.uploadedById !== user.id) throw notFound('Media');
    return m;
  }

  async get(user: AuthUser, id: string) {
    const m = await this.load(user, id);
    return {
      ...(await this.mapper.toDto(m, user)),
      mimeType: m.detectedMime ?? m.mimeType,
      cameraModel: m.cameraModel,
      isRaw: m.isRaw,
      isPublicHighlight: m.isPublicHighlight,
      eventTitle: m.event.title,
    };
  }

  async setTags(tx: Prisma.TransactionClient, mediaId: string, names: string[]): Promise<void> {
    await tx.mediaTag.deleteMany({ where: { mediaId } });
    await this.addTags(tx, [mediaId], names);
  }

  private async addTags(tx: Prisma.TransactionClient, mediaIds: string[], names: string[]): Promise<void> {
    const clean = normalizeTags(names);
    if (!clean.length || !mediaIds.length) return;
    await tx.tag.createMany({ data: clean.map((name) => ({ name })), skipDuplicates: true });
    const tags = await tx.tag.findMany({ where: { name: { in: clean } }, select: { id: true } });
    await tx.mediaTag.createMany({ data: mediaIds.flatMap((mediaId) => tags.map((t) => ({ mediaId, tagId: t.id }))), skipDuplicates: true });
  }

  async update(
    user: AuthUser,
    id: string,
    dto: { caption?: string | null; isFeatured?: boolean; sortOrder?: number; tags?: string[]; isPublicHighlight?: boolean },
    meta: ReqMeta,
  ) {
    const m = await this.load(user, id);
    if (!this.policy.canEditMedia(user, { uploadedById: m.uploadedById, categoryId: m.event.categoryId })) throw forbidden();
    if (dto.isPublicHighlight !== undefined && !this.policy.canSetPublicHighlight(user)) throw forbidden('Only admins can publish highlights');
    await this.prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({
        where: { id },
        data: { caption: dto.caption === undefined ? undefined : dto.caption?.trim() || null, isFeatured: dto.isFeatured, sortOrder: dto.sortOrder, isPublicHighlight: dto.isPublicHighlight },
      });
      if (dto.tags) await this.setTags(tx, id, dto.tags);
      await this.audit.record({ actorId: user.id, action: 'MEDIA_UPDATED', entityType: 'MEDIA', entityId: id, metadata: dto as Prisma.InputJsonValue, meta }, tx);
    });
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const res = await this.bulk(user, { action: 'delete', mediaIds: [id] }, meta);
    if (res.failed.length) throw res.failed[0]!.code === 'NOT_FOUND' ? notFound('Media') : forbidden();
  }

  async bulk(user: AuthUser, dto: { action: BulkAction; mediaIds: string[]; targetEventId?: string; tags?: string[] }, meta: ReqMeta) {
    const ids = [...new Set(dto.mediaIds)].slice(0, DEFAULT_LIMITS.maxBulkIds);
    const rows = await this.prisma.mediaAsset.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, eventId: true, uploadedById: true, status: true, event: { select: { categoryId: true, createdById: true, status: true, deletedAt: true } } },
    });
    const found = new Map(rows.map((r) => [r.id, r]));
    const failed: Array<{ id: string; code: string }> = [];
    const ok: typeof rows = [];

    let target: { id: string; categoryId: string } | null = null;
    if (dto.action === 'move') {
      if (!dto.targetEventId) throw badRequest('TARGET_REQUIRED', 'Choose an event to move to');
      const t = await this.events.load(user, dto.targetEventId);
      target = { id: t.id, categoryId: t.categoryId };
    }
    if ((dto.action === 'tag' || dto.action === 'untag') && !normalizeTags(dto.tags ?? []).length)
      throw badRequest('TAGS_REQUIRED', 'Enter at least one tag');

    for (const id of ids) {
      const r = found.get(id);
      if (!r || r.event.deletedAt || !this.policy.canViewEvent(user, r.event)) {
        failed.push({ id, code: 'NOT_FOUND' });
        continue;
      }
      const like = { uploadedById: r.uploadedById, categoryId: r.event.categoryId };
      const allowed =
        dto.action === 'move'
          ? this.policy.canMoveMedia(user, r.event.categoryId, target!.categoryId) && r.eventId !== target!.id
          : this.policy.canEditMedia(user, like);
      if (!allowed) failed.push({ id, code: 'FORBIDDEN' });
      else ok.push(r);
    }

    const okIds = ok.map((r) => r.id);
    const touched = new Set(ok.map((r) => r.eventId));
    if (okIds.length) {
      await this.prisma.$transaction(async (tx) => {
        switch (dto.action) {
          case 'delete': {
            const now = new Date();
            await tx.mediaAsset.updateMany({
              where: { id: { in: okIds } },
              data: { deletedAt: now, deletedById: user.id, purgeAfter: new Date(now.getTime() + this.env.TRASH_RETENTION_DAYS * 86_400_000) },
            });
            // A deleted cover stops being the cover.
            await tx.event.updateMany({ where: { coverMediaId: { in: okIds } }, data: { coverMediaId: null } });
            break;
          }
          case 'move':
            await tx.mediaAsset.updateMany({ where: { id: { in: okIds } }, data: { eventId: target!.id } });
            await tx.event.updateMany({ where: { coverMediaId: { in: okIds }, id: { not: target!.id } }, data: { coverMediaId: null } });
            touched.add(target!.id);
            break;
          case 'tag':
            await this.addTags(tx, okIds, dto.tags ?? []);
            break;
          case 'untag': {
            const tags = await tx.tag.findMany({ where: { name: { in: normalizeTags(dto.tags ?? []), mode: 'insensitive' } }, select: { id: true } });
            await tx.mediaTag.deleteMany({ where: { mediaId: { in: okIds }, tagId: { in: tags.map((t) => t.id) } } });
            break;
          }
          case 'feature':
          case 'unfeature':
            await tx.mediaAsset.updateMany({ where: { id: { in: okIds } }, data: { isFeatured: dto.action === 'feature' } });
            break;
        }
        if (dto.action === 'delete' || dto.action === 'move') await recountEvents(tx, touched);
        await this.audit.record(
          {
            actorId: user.id,
            action: `MEDIA_BULK_${dto.action.toUpperCase()}`,
            entityType: 'MEDIA',
            metadata: { count: okIds.length, mediaIds: okIds.slice(0, 100), targetEventId: dto.targetEventId ?? null, tags: dto.tags ?? null },
            meta,
          },
          tx,
        );
      });
    }
    return { succeeded: okIds, failed };
  }

  async restore(user: AuthUser, id: string, meta: ReqMeta) {
    const m = await this.prisma.mediaAsset.findUnique({ where: { id }, include: { event: true } });
    if (!m || !m.deletedAt) throw notFound('Media');
    if (!this.policy.canRestore(user, m.uploadedById)) throw forbidden();
    if (m.event.deletedAt) throw badRequest('EVENT_DELETED', 'Restore the event first');
    await this.prisma.$transaction(async (tx) => {
      await tx.mediaAsset.update({ where: { id }, data: { deletedAt: null, deletedById: null, purgeAfter: null } });
      await recountEvents(tx, [m.eventId]);
      await this.audit.record({ actorId: user.id, action: 'MEDIA_RESTORED', entityType: 'MEDIA', entityId: id, meta }, tx);
    });
    return this.get(user, id);
  }

  async reprocess(user: AuthUser, id: string, meta: ReqMeta) {
    if (!this.policy.canReprocess(user)) throw forbidden();
    const m = await this.load(user, id);
    if (m.status === 'PENDING_UPLOAD') throw badRequest('NOT_UPLOADED', 'The upload has not finished');
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.mediaAsset.update({ where: { id }, data: { status: 'UPLOADED', processingError: null, processingAttempts: { increment: 1 } } });
      await recountEvents(tx, [m.eventId]);
      return u;
    });
    await this.queue.processMedia(m.type, { mediaId: id }, updated.processingAttempts);
    await this.audit.record({ actorId: user.id, action: 'MEDIA_REPROCESS', entityType: 'MEDIA', entityId: id, meta });
    return { status: updated.status };
  }

  async downloadUrl(user: AuthUser, id: string, meta: ReqMeta): Promise<string> {
    const m = await this.load(user, id);
    if (m.status === 'PENDING_UPLOAD') throw notFound('Media');
    await this.audit.record({ actorId: user.id, action: 'MEDIA_DOWNLOADED', entityType: 'MEDIA', entityId: id, metadata: { filename: m.originalFilename }, meta });
    return this.delivery.downloadUrl(m.originalKey, m.originalFilename);
  }
}
