import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { forbidden } from '../common/errors';

/** Storage usage per category and year (§19). */
@Controller('stats')
export class StatsController {
  constructor(private readonly prisma: PrismaService, private readonly policy: PolicyService) {}

  @Get('storage')
  async storage(@CurrentUser() user: AuthUser) {
    if (!this.policy.canViewStorageStats(user)) throw forbidden();
    const [byCategoryYear, variants, trash, totals] = await Promise.all([
      this.prisma.$queryRaw<Array<{ categoryId: string; name: string; sortOrder: number; year: number; photos: number; videos: number; bytes: string }>>`
        SELECT c.id AS "categoryId", c.name, c."sortOrder", EXTRACT(YEAR FROM e."eventDate")::int AS year,
               count(*) FILTER (WHERE m.type = 'IMAGE')::int AS photos,
               count(*) FILTER (WHERE m.type = 'VIDEO')::int AS videos,
               COALESCE(sum(m."sizeBytes"), 0)::text AS bytes
        FROM "MediaAsset" m JOIN "Event" e ON e.id = m."eventId" JOIN "Category" c ON c.id = e."categoryId"
        WHERE m."deletedAt" IS NULL AND m.status <> 'PENDING_UPLOAD'
        GROUP BY 1, 2, 3, 4 ORDER BY 3, 4 DESC`,
      this.prisma.$queryRaw<Array<{ bytes: string }>>`
        SELECT COALESCE(sum(v."sizeBytes"), 0)::text AS bytes FROM "MediaVariant" v`,
      this.prisma.$queryRaw<Array<{ count: number; bytes: string }>>`
        SELECT count(*)::int AS count, COALESCE(sum("sizeBytes"), 0)::text AS bytes FROM "MediaAsset" WHERE "deletedAt" IS NOT NULL`,
      this.prisma.$queryRaw<Array<{ count: number; bytes: string; processing: number; failed: number }>>`
        SELECT count(*)::int AS count, COALESCE(sum("sizeBytes"), 0)::text AS bytes,
               count(*) FILTER (WHERE status IN ('UPLOADED', 'PROCESSING'))::int AS processing,
               count(*) FILTER (WHERE status = 'FAILED')::int AS failed
        FROM "MediaAsset" WHERE "deletedAt" IS NULL AND status <> 'PENDING_UPLOAD'`,
    ]);
    return {
      totals: { files: totals[0]?.count ?? 0, originalBytes: totals[0]?.bytes ?? '0', variantBytes: variants[0]?.bytes ?? '0', processing: totals[0]?.processing ?? 0, failed: totals[0]?.failed ?? 0 },
      trash: { files: trash[0]?.count ?? 0, bytes: trash[0]?.bytes ?? '0' },
      byCategoryYear,
    };
  }
}

@Module({ controllers: [StatsController] })
export class StatsModule {}
