import { Controller, Get, Inject, Module, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryService } from '../delivery/delivery.service';
import { Public } from '../common/decorators';
import { notFound } from '../common/errors';
import { clampLimit, fromDateOnly } from '../common/pagination';

class PageDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() limit?: number;
}

/**
 * Public "highlights" for the church website (§19). Off unless
 * PUBLIC_HIGHLIGHTS_ENABLED=true. Only admin-marked media in published events;
 * previews only — never originals, never uploader names.
 */
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('public/highlights')
export class HighlightsController {
  constructor(private readonly prisma: PrismaService, private readonly delivery: DeliveryService, @Inject(ENV) private readonly env: Env) {}

  @Get()
  async list(@Query() q: PageDto, @Res({ passthrough: true }) res: Response) {
    if (!this.env.PUBLIC_HIGHLIGHTS_ENABLED) throw notFound('Page');
    res.setHeader('Cache-Control', 'public, max-age=300');
    const take = clampLimit(q.limit);
    const rows = await this.prisma.mediaAsset.findMany({
      where: { isPublicHighlight: true, status: 'READY', deletedAt: null, event: { deletedAt: null, status: 'PUBLISHED', category: { isActive: true } } },
      include: { variants: { where: { kind: { not: 'VIDEO_PREVIEW' } }, select: { kind: true, key: true } }, event: { select: { title: true, eventDate: true, category: { select: { name: true } } } } },
      orderBy: [{ event: { eventDate: 'desc' } }, { id: 'asc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: Buffer.from(q.cursor, 'base64url').toString() }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    const items = await Promise.all(
      page.map(async (m) => {
        const byKind = new Map(m.variants.map((v) => [v.kind, v.key]));
        const thumb = byKind.get('THUMB') ?? byKind.get('POSTER');
        const preview = byKind.get('PREVIEW') ?? byKind.get('POSTER');
        return {
          id: m.id,
          type: m.type,
          width: m.width,
          height: m.height,
          caption: m.caption,
          event: { title: m.event.title, date: fromDateOnly(m.event.eventDate), category: m.event.category.name },
          thumbUrl: thumb ? await this.delivery.publicUrlFor(thumb) : null,
          previewUrl: preview ? await this.delivery.publicUrlFor(preview) : null,
        };
      }),
    );
    return { items, nextCursor: rows.length > take ? Buffer.from(page[page.length - 1]!.id).toString('base64url') : null };
  }
}

@Module({ controllers: [HighlightsController] })
export class HighlightsModule {}
