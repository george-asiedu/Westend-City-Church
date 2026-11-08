import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@wcc/db';
import { defaultEventTitle, slugify, type EventDto } from '@wcc/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { MediaMapper } from '../media/media-mapper.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import { clampLimit, decodeCursor, encodeCursor, fromDateOnly, toDateOnly } from '../common/pagination';
import { recountEvents } from '@wcc/db';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

const EVENT_INCLUDE = {
  category: { select: { id: true, slug: true, name: true, allowsMultiDay: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.EventInclude;
type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

export interface ListEventsQuery {
  categoryId?: string;
  from?: string;
  to?: string;
  year?: number;
  month?: number;
  programType?: string;
  q?: string;
  status?: 'DRAFT' | 'PUBLISHED';
  cursor?: string;
  limit?: number;
}

export interface EventInput {
  categoryId: string;
  eventDate: string;
  endDate?: string | null;
  title?: string;
  programType?: string | null;
  location?: string | null;
  description?: string | null;
  status?: 'DRAFT' | 'PUBLISHED';
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly mapper: MediaMapper,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async toDtos(rows: EventRow[], user: AuthUser, withPerms = false): Promise<EventDto[]> {
    const covers = await this.mapper.thumbUrls(rows.map((r) => r.coverMediaId));
    return rows.map((e) => ({
      id: e.id,
      categoryId: e.categoryId,
      category: e.category,
      title: e.title,
      slug: e.slug,
      eventDate: fromDateOnly(e.eventDate)!,
      endDate: fromDateOnly(e.endDate),
      programType: e.programType,
      location: e.location,
      description: e.description,
      status: e.status,
      mediaCount: e.mediaCount,
      photoCount: e.photoCount,
      videoCount: e.videoCount,
      totalBytes: e.totalBytes.toString(),
      coverMediaId: e.coverMediaId,
      coverThumbUrl: e.coverMediaId ? (covers.get(e.coverMediaId) ?? null) : null,
      createdBy: e.createdBy,
      createdAt: e.createdAt.toISOString(),
      ...(withPerms
        ? {
            canEdit: this.policy.canEditEvent(user, e),
            canDelete: this.policy.canDeleteEvent(user, e),
            canUpload: this.policy.canUploadToEvent(user, e),
            canShare: this.policy.canShareEvent(user, e),
          }
        : {}),
    }));
  }

  /** Visibility filter: categories the user may view, and drafts only where allowed (§6.1). */
  visibleWhere(user: AuthUser): Prisma.EventWhereInput {
    if (this.policy.isAdmin(user)) return { deletedAt: null };
    const hidden = [...user.grants.entries()].filter(([, g]) => !g.canView).map(([id]) => id);
    const managed = [...user.grants.entries()].filter(([, g]) => g.canManage).map(([id]) => id);
    const draftsOk = user.role === 'MEDIA_TEAM' || user.role === 'PASTOR';
    return {
      deletedAt: null,
      categoryId: hidden.length ? { notIn: hidden } : undefined,
      category: { isActive: true },
      OR: [{ status: 'PUBLISHED' }, { createdById: user.id }, ...(draftsOk && managed.length ? [{ categoryId: { in: managed } }] : [])],
    };
  }

  async list(user: AuthUser, q: ListEventsQuery) {
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor<{ d: string; id: string }>(q.cursor);
    let from = q.from;
    let to = q.to;
    if (q.year) {
      const m = q.month;
      from = m ? `${q.year}-${String(m).padStart(2, '0')}-01` : `${q.year}-01-01`;
      const end = m ? new Date(Date.UTC(q.year, m, 0)) : new Date(Date.UTC(q.year, 11, 31));
      to = end.toISOString().slice(0, 10);
    }
    const where: Prisma.EventWhereInput = {
      AND: [
        this.visibleWhere(user),
        {
          categoryId: q.categoryId,
          status: q.status,
          programType: q.programType ? { equals: q.programType, mode: 'insensitive' } : undefined,
          title: q.q ? { contains: q.q, mode: 'insensitive' } : undefined,
          eventDate: from || to ? { gte: from ? toDateOnly(from) : undefined, lte: to ? toDateOnly(to) : undefined } : undefined,
        },
        cursor
          ? { OR: [{ eventDate: { lt: toDateOnly(cursor.d) } }, { eventDate: toDateOnly(cursor.d), id: { lt: cursor.id } }] }
          : {},
      ],
    };
    const rows = await this.prisma.event.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.toDtos(page, user),
      nextCursor: rows.length > limit && last ? encodeCursor({ d: fromDateOnly(last.eventDate)!, id: last.id }) : null,
    };
  }

  /** Loads a visible event or 404s (never 403: no leaking existence, §13). */
  async load(user: AuthUser, id: string, opts: { includeDeleted?: boolean } = {}): Promise<EventRow> {
    const e = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });
    if (!e || (e.deletedAt && !opts.includeDeleted) || !this.policy.canViewEvent(user, e)) throw notFound('Event');
    return e;
  }

  async get(user: AuthUser, id: string): Promise<EventDto> {
    const [dto] = await this.toDtos([await this.load(user, id)], user, true);
    return dto!;
  }

  private async uniqueSlug(tx: Prisma.TransactionClient, categoryId: string, date: Date, title: string, excludeId?: string): Promise<string> {
    const base = slugify(title);
    const taken = new Set(
      (
        await tx.event.findMany({
          where: { categoryId, eventDate: date, slug: { startsWith: base }, id: excludeId ? { not: excludeId } : undefined },
          select: { slug: true },
        })
      ).map((e) => e.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  async create(user: AuthUser, dto: EventInput, meta: ReqMeta): Promise<EventDto> {
    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category || !category.isActive) throw notFound('Category');
    if (!this.policy.canCreateEvent(user, category.id)) throw forbidden('You cannot create events in this category');
    if (dto.endDate && !category.allowsMultiDay) throw badRequest('NO_MULTI_DAY', `${category.name} events are single-day`);
    if (dto.endDate && dto.endDate < dto.eventDate) throw badRequest('BAD_DATES', 'End date must be on or after the start date');

    const title = dto.title?.trim() || defaultEventTitle(category.name, dto.eventDate);
    const eventDate = toDateOnly(dto.eventDate);
    const created = await this.prisma.$transaction(async (tx) => {
      const e = await tx.event.create({
        data: {
          categoryId: category.id,
          title,
          slug: await this.uniqueSlug(tx, category.id, eventDate, title),
          eventDate,
          endDate: dto.endDate ? toDateOnly(dto.endDate) : null,
          programType: dto.programType?.trim() || null,
          location: dto.location?.trim() || null,
          description: dto.description?.trim() || null,
          status: dto.status ?? 'PUBLISHED',
          createdById: user.id,
        },
      });
      await this.audit.record({ actorId: user.id, action: 'EVENT_CREATED', entityType: 'EVENT', entityId: e.id, metadata: { title, categoryId: category.id, eventDate: dto.eventDate }, meta }, tx);
      return e;
    });
    return this.get(user, created.id);
  }

  async update(user: AuthUser, id: string, dto: Partial<EventInput>, meta: ReqMeta): Promise<EventDto> {
    const e = await this.load(user, id);
    if (!this.policy.canEditEvent(user, e)) throw forbidden();
    let category = e.category;
    if (dto.categoryId && dto.categoryId !== e.categoryId) {
      if (!this.policy.canMoveMedia(user, e.categoryId, dto.categoryId)) throw forbidden('You need manage rights on both categories');
      const c = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!c) throw notFound('Category');
      category = c;
    }
    const eventDate = dto.eventDate ?? fromDateOnly(e.eventDate)!;
    let endDate = dto.endDate === undefined ? fromDateOnly(e.endDate) : dto.endDate || null;
    if (!category.allowsMultiDay) endDate = null;
    if (endDate && endDate < eventDate) throw badRequest('BAD_DATES', 'End date must be on or after the start date');
    const title = dto.title?.trim() || e.title;
    const keysChanged = title !== e.title || eventDate !== fromDateOnly(e.eventDate) || category.id !== e.categoryId;

    await this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id },
        data: {
          categoryId: category.id,
          title,
          slug: keysChanged ? await this.uniqueSlug(tx, category.id, toDateOnly(eventDate), title, id) : undefined,
          eventDate: toDateOnly(eventDate),
          endDate: endDate ? toDateOnly(endDate) : null,
          programType: dto.programType === undefined ? undefined : dto.programType?.trim() || null,
          location: dto.location === undefined ? undefined : dto.location?.trim() || null,
          description: dto.description === undefined ? undefined : dto.description?.trim() || null,
          status: dto.status,
          updatedById: user.id,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'EVENT_UPDATED',
          entityType: 'EVENT',
          entityId: id,
          metadata: { before: { title: e.title, eventDate: fromDateOnly(e.eventDate), categoryId: e.categoryId, status: e.status }, after: { ...dto } } as Prisma.InputJsonValue,
          meta,
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  /** Soft-deletes the event and all its media in one transaction (§10.4). */
  async remove(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const e = await this.load(user, id);
    if (!this.policy.canDeleteEvent(user, e)) throw forbidden();
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + this.env.TRASH_RETENTION_DAYS * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id }, data: { deletedAt: now, deletedById: user.id } });
      const res = await tx.mediaAsset.updateMany({ where: { eventId: id, deletedAt: null }, data: { deletedAt: now, deletedById: user.id, purgeAfter } });
      await recountEvents(tx, [id]);
      await this.audit.record({ actorId: user.id, action: 'EVENT_DELETED', entityType: 'EVENT', entityId: id, metadata: { title: e.title, mediaCount: res.count }, meta }, tx);
    });
  }

  async restore(user: AuthUser, id: string, meta: ReqMeta): Promise<EventDto> {
    const e = await this.prisma.event.findUnique({ where: { id }, include: EVENT_INCLUDE });
    if (!e || !e.deletedAt) throw notFound('Event');
    if (!this.policy.canRestore(user, e.createdById)) throw forbidden();
    await this.prisma.$transaction(async (tx) => {
      // Media deleted together with the event share its timestamp.
      await tx.mediaAsset.updateMany({ where: { eventId: id, deletedAt: e.deletedAt }, data: { deletedAt: null, deletedById: null, purgeAfter: null } });
      await tx.event.update({ where: { id }, data: { deletedAt: null, deletedById: null } });
      await recountEvents(tx, [id]);
      await this.audit.record({ actorId: user.id, action: 'EVENT_RESTORED', entityType: 'EVENT', entityId: id, meta }, tx);
    });
    return this.get(user, id);
  }

  async lookup(user: AuthUser, categoryId: string, date: string): Promise<EventDto[]> {
    const rows = await this.prisma.event.findMany({
      where: { AND: [this.visibleWhere(user), { categoryId, eventDate: toDateOnly(date) }] },
      include: EVENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return this.toDtos(rows, user, true);
  }

  async setCover(user: AuthUser, id: string, mediaId: string, meta: ReqMeta): Promise<EventDto> {
    const e = await this.load(user, id);
    if (!this.policy.canEditEvent(user, e)) throw forbidden();
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, eventId: id, status: 'READY', deletedAt: null } });
    if (!m) throw notFound('Media');
    await this.prisma.event.update({ where: { id }, data: { coverMediaId: mediaId } });
    await this.audit.record({ actorId: user.id, action: 'EVENT_COVER_SET', entityType: 'EVENT', entityId: id, metadata: { mediaId }, meta });
    return this.get(user, id);
  }
}
