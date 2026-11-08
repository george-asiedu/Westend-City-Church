import { Injectable } from '@nestjs/common';
import type { CategoryDto } from '@wcc/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { MediaMapper } from '../media/media-mapper.service';
import { forbidden, notFound } from '../common/errors';
import { fromDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly mapper: MediaMapper,
  ) {}

  async list(user: AuthUser): Promise<CategoryDto[]> {
    const isAdmin = this.policy.isAdmin(user);
    const cats = (await this.prisma.category.findMany({ where: isAdmin ? {} : { isActive: true }, orderBy: { sortOrder: 'asc' } })).filter((c) =>
      this.policy.canViewCategory(user, c.id),
    );
    const stats = await this.prisma.event.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null, status: 'PUBLISHED', categoryId: { in: cats.map((c) => c.id) } },
      _count: { _all: true },
      _max: { eventDate: true },
    });
    const byCat = new Map(stats.map((s) => [s.categoryId, s]));
    // Fallback cover: the latest event's cover in each category.
    const latest = await this.prisma.event.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', coverMediaId: { not: null }, categoryId: { in: cats.map((c) => c.id) } },
      orderBy: { eventDate: 'desc' },
      distinct: ['categoryId'],
      select: { categoryId: true, coverMediaId: true },
    });
    const latestCover = new Map(latest.map((l) => [l.categoryId, l.coverMediaId]));
    const covers = await this.mapper.thumbUrls(cats.map((c) => c.coverMediaId ?? latestCover.get(c.id)));
    return cats.map((c) => {
      const s = byCat.get(c.id);
      const coverId = c.coverMediaId ?? latestCover.get(c.id);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
        allowsMultiDay: c.allowsMultiDay,
        isActive: c.isActive,
        eventCount: s?._count._all ?? 0,
        latestEventDate: fromDateOnly(s?._max.eventDate ?? null),
        coverThumbUrl: coverId ? (covers.get(coverId) ?? null) : null,
      };
    });
  }

  async bySlug(user: AuthUser, slug: string) {
    const c = await this.prisma.category.findUnique({ where: { slug } });
    if (!c || (!c.isActive && !this.policy.isAdmin(user)) || !this.policy.canViewCategory(user, c.id)) throw notFound('Category');
    return { ...c, canUpload: this.policy.canUpload(user, c.id), canManage: this.policy.canManageCategoryContent(user, c.id) };
  }

  async timeline(user: AuthUser, slug: string) {
    const c = await this.bySlug(user, slug);
    const rows = await this.prisma.$queryRaw<Array<{ year: number; month: number; count: number }>>`
      SELECT EXTRACT(YEAR FROM "eventDate")::int AS year, EXTRACT(MONTH FROM "eventDate")::int AS month, count(*)::int AS count
      FROM "Event"
      WHERE "categoryId" = ${c.id}::uuid AND "deletedAt" IS NULL
        AND (status = 'PUBLISHED' OR "createdById" = ${user.id}::uuid OR ${c.canManage})
      GROUP BY 1, 2 ORDER BY 1 DESC, 2 DESC`;
    const years = new Map<number, Array<{ month: number; eventCount: number }>>();
    for (const r of rows) {
      if (!years.has(r.year)) years.set(r.year, []);
      years.get(r.year)!.push({ month: r.month, eventCount: r.count });
    }
    return [...years.entries()].map(([year, months]) => ({ year, months }));
  }

  async update(
    user: AuthUser,
    id: string,
    dto: { name?: string; description?: string | null; sortOrder?: number; isActive?: boolean; coverMediaId?: string | null },
    meta: ReqMeta,
  ) {
    if (!this.policy.canManageCategories(user)) throw forbidden();
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw notFound('Category');
    if (dto.coverMediaId) {
      const m = await this.prisma.mediaAsset.findFirst({ where: { id: dto.coverMediaId, status: 'READY', deletedAt: null, event: { categoryId: id } } });
      if (!m) throw notFound('Cover media');
    }
    const updated = await this.prisma.category.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: user.id,
      action: 'CATEGORY_UPDATED',
      entityType: 'CATEGORY',
      entityId: id,
      metadata: { before: { name: before.name, sortOrder: before.sortOrder, isActive: before.isActive }, after: dto },
      meta,
    });
    return updated;
  }
}
