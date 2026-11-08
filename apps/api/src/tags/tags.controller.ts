import { Controller, Get, Module, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

class TagQuery {
  @IsOptional() @IsString() @MaxLength(40) q?: string;
}

@Controller('tags')
export class TagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() { q }: TagQuery) {
    const rows = await this.prisma.tag.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { media: { _count: 'desc' } },
      take: 20,
      select: { name: true, _count: { select: { media: true } } },
    });
    return rows.map((r) => ({ name: r.name, count: r._count.media }));
  }
}

@Module({ controllers: [TagsController] })
export class TagsModule {}
