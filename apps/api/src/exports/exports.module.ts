import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { DeliveryService } from '../delivery/delivery.service';
import { EventsService } from '../events/events.service';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { badRequest, notFound } from '../common/errors';
import { AppException } from '../common/errors';
import { HttpStatus } from '@nestjs/common';

class CreateExportDto {
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('4', { each: true }) mediaIds?: string[];
}

/** ZIP download of an event or a selection (§19). Built by the worker into exports/, kept 24 h. */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly delivery: DeliveryService,
    private readonly events: EventsService,
  ) {}

  async create(user: AuthUser, dto: CreateExportDto, meta: ReqMeta) {
    if (!!dto.eventId === !!dto.mediaIds?.length) throw badRequest('EXPORT_TARGET', 'Export either an event or a selection');
    const running = await this.prisma.exportJob.count({ where: { requestedById: user.id, status: { in: ['PENDING', 'RUNNING'] } } });
    if (running >= 2) throw new AppException(HttpStatus.TOO_MANY_REQUESTS, 'EXPORT_BUSY', 'Wait for your current downloads to finish');

    let ids: string[];
    let title: string;
    if (dto.eventId) {
      const e = await this.events.load(user, dto.eventId);
      title = e.title;
      ids = (await this.prisma.mediaAsset.findMany({ where: { eventId: e.id, deletedAt: null, status: 'READY' }, select: { id: true } })).map((m) => m.id);
    } else {
      const rows = await this.prisma.mediaAsset.findMany({
        where: { id: { in: dto.mediaIds }, deletedAt: null, status: 'READY' },
        select: { id: true, event: { select: { categoryId: true, createdById: true, status: true, deletedAt: true, title: true } } },
      });
      const visible = rows.filter((r) => !r.event.deletedAt && this.policy.canViewEvent(user, r.event));
      ids = visible.map((r) => r.id);
      title = visible[0]?.event.title ?? 'Selection';
    }
    if (!ids.length) throw badRequest('EMPTY', 'Nothing to download');
    const job = await this.prisma.exportJob.create({
      data: { requestedById: user.id, eventId: dto.eventId ?? null, mediaIds: ids, title, expiresAt: new Date(Date.now() + 24 * 3600_000) },
    });
    await this.queue.exportZip({ exportId: job.id });
    await this.audit.record({ actorId: user.id, action: 'EXPORT_REQUESTED', entityType: 'EXPORT', entityId: job.id, metadata: { files: ids.length, eventId: dto.eventId ?? null }, meta });
    return this.shape(job);
  }

  private shape(j: { id: string; title: string; status: string; fileCount: number; sizeBytes: bigint; createdAt: Date; completedAt: Date | null; expiresAt: Date; mediaIds: string[] }) {
    return { id: j.id, title: j.title, status: j.status, fileCount: j.fileCount || j.mediaIds.length, sizeBytes: j.sizeBytes.toString(), createdAt: j.createdAt, completedAt: j.completedAt, expiresAt: j.expiresAt };
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.exportJob.findMany({ where: { requestedById: user.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((r) => this.shape(r));
  }

  async get(user: AuthUser, id: string) {
    const j = await this.prisma.exportJob.findFirst({ where: { id, requestedById: user.id } });
    if (!j) throw notFound('Export');
    return this.shape(j);
  }

  async downloadUrl(user: AuthUser, id: string, meta: ReqMeta) {
    const j = await this.prisma.exportJob.findFirst({ where: { id, requestedById: user.id } });
    if (!j || j.status !== 'READY' || !j.key || j.expiresAt < new Date()) throw notFound('Export');
    await this.audit.record({ actorId: user.id, action: 'EXPORT_DOWNLOADED', entityType: 'EXPORT', entityId: id, meta });
    return this.delivery.downloadUrl(j.key, `${j.title.replace(/[^\w\- ]+/g, '').trim() || 'media'}.zip`);
  }
}

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExportDto, @Meta() meta: ReqMeta) {
    return this.exports.create(user, dto, meta);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.exports.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exports.get(user, id);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: ReqMeta, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, await this.exports.downloadUrl(user, id, meta));
  }
}

@Module({ controllers: [ExportsController], providers: [ExportsService] })
export class ExportsModule {}
