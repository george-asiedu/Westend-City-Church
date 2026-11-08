import { Controller, Get, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@wcc/db';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { forbidden } from '../common/errors';
import { clampLimit, decodeCursor, encodeCursor } from '../common/pagination';
import { Type } from 'class-transformer';

class AuditQuery {
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() @MaxLength(60) action?: string;
  @IsOptional() @IsString() @MaxLength(30) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) limit?: number;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService, private readonly policy: PolicyService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: AuditQuery) {
    if (!this.policy.canViewAudit(user)) throw forbidden();
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor<{ id: string }>(q.cursor);
    const where: Prisma.AuditLogWhereInput = {
      actorId: q.actorId,
      action: q.action,
      entityType: q.entityType,
      entityId: q.entityId,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
      ...(cursor ? { id: { lt: BigInt(cursor.id) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({ ...r, id: r.id.toString() })),
      nextCursor: rows.length > limit ? encodeCursor({ id: page[page.length - 1]!.id.toString() }) : null,
    };
  }
}
