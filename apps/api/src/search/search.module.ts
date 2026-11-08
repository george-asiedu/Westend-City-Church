import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Prisma } from '@wcc/db';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { MEDIA_INCLUDE, MediaMapper } from '../media/media-mapper.service';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { toDateOnly } from '../common/pagination';

class SearchQuery {
  @IsString() @MinLength(2) @MaxLength(100) q!: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsEnum(['IMAGE', 'VIDEO']) type?: 'IMAGE' | 'VIDEO';
}

/** Trigram-backed (§5.2) ILIKE search over titles, captions, filenames and tags. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly mapper: MediaMapper) {}

  async search(user: AuthUser, q: SearchQuery) {
    const term = q.q.trim();
    const dateFilter = q.from || q.to ? { gte: q.from ? toDateOnly(q.from) : undefined, lte: q.to ? toDateOnly(q.to) : undefined } : undefined;
    const visible = this.events.visibleWhere(user);
    const eventWhere: Prisma.EventWhereInput = {
      AND: [
        visible,
        { categoryId: q.categoryId, eventDate: dateFilter },
        { OR: [{ title: { contains: term, mode: 'insensitive' } }, { programType: { contains: term, mode: 'insensitive' } }, { location: { contains: term, mode: 'insensitive' } }] },
      ],
    };
    const [events, media] = await Promise.all([
      this.prisma.event.findMany({
        where: eventWhere,
        include: { category: { select: { id: true, slug: true, name: true, allowsMultiDay: true } }, createdBy: { select: { id: true, fullName: true } } },
        orderBy: { eventDate: 'desc' },
        take: 30,
      }),
      this.prisma.mediaAsset.findMany({
        where: {
          deletedAt: null,
          status: 'READY',
          type: q.type,
          event: { AND: [visible, { categoryId: q.categoryId, eventDate: dateFilter }] },
          OR: [
            { caption: { contains: term, mode: 'insensitive' } },
            { originalFilename: { contains: term, mode: 'insensitive' } },
            { tags: { some: { tag: { name: { contains: term, mode: 'insensitive' } } } } },
          ],
        },
        include: MEDIA_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 120,
      }),
    ]);
    return { events: await this.events.toDtos(events, user), media: await this.mapper.toDtos(media, user) };
  }
}

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  run(@CurrentUser() user: AuthUser, @Query() q: SearchQuery) {
    return this.search.search(user, q);
  }
}

@Module({ controllers: [SearchController], providers: [SearchService] })
export class SearchModule {}
