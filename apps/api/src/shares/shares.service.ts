import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma } from '@wcc/db';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PasswordService } from '../auth/password.service';
import { EventsService } from '../events/events.service';
import { QueueService } from '../queue/queue.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { randomToken, safeEqual, sha256 } from '../common/crypto';
import { clampLimit, fromDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { HttpStatus } from '@nestjs/common';

export interface CreateShareInput {
  eventId?: string;
  mediaIds?: string[];
  title?: string;
  expiresInHours: number;
  password?: string;
  allowDownload: boolean;
}

type LinkRow = Prisma.ShareLinkGetPayload<{ include: { event: { select: { id: true; title: true; eventDate: true; endDate: true; deletedAt: true } } } }>;

const gone = () => new AppException(HttpStatus.GONE, 'LINK_EXPIRED', 'This link has expired or was turned off');

/**
 * Time-limited share links for people outside the system (§19).
 * The token is shown once and stored only as a SHA-256 hash.
 */
@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly delivery: DeliveryService,
    private readonly passwords: PasswordService,
    private readonly events: EventsService,
    private readonly queue: QueueService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertEnabled(): void {
    if (!this.env.SHARE_LINKS_ENABLED) throw notFound('Share link');
  }

  url(token: string): string {
    return `${this.env.WEB_ORIGIN}/s/${token}`;
  }

  // ───────────── members ─────────────

  async create(user: AuthUser, dto: CreateShareInput, meta: ReqMeta) {
    this.assertEnabled();
    if (!!dto.eventId === !!dto.mediaIds?.length) throw badRequest('SHARE_TARGET', 'Share either a whole event or a selection of media');
    let title = dto.title?.trim();
    let eventId: string | null = null;
    let mediaIds: string[] = [];

    if (dto.eventId) {
      const e = await this.events.load(user, dto.eventId);
      if (!this.policy.canShareEvent(user, e)) throw forbidden('You cannot share this event');
      if (e.status !== 'PUBLISHED') throw badRequest('EVENT_DRAFT', 'Publish the event before sharing it');
      eventId = e.id;
      title ||= e.title;
    } else {
      const ids = [...new Set(dto.mediaIds)];
      const rows = await this.prisma.mediaAsset.findMany({
        where: { id: { in: ids }, deletedAt: null, status: 'READY' },
        select: { id: true, event: { select: { categoryId: true, createdById: true, status: true, deletedAt: true, title: true } } },
      });
      if (rows.length !== ids.length) throw badRequest('MEDIA_UNAVAILABLE', 'Some items are missing or still processing');
      for (const r of rows) if (r.event.deletedAt || !this.policy.canShareEvent(user, r.event)) throw forbidden('You cannot share some of these items');
      mediaIds = ids;
      title ||= rows[0]?.event.title ?? 'Shared photos';
    }

    const token = randomToken(24);
    const link = await this.prisma.$transaction(async (tx) => {
      const l = await tx.shareLink.create({
        data: {
          tokenHash: sha256(token),
          tokenPrefix: token.slice(0, 8),
          title: title!.slice(0, 160),
          eventId,
          passwordHash: dto.password ? await this.passwords.hash(dto.password) : null,
          allowDownload: dto.allowDownload,
          expiresAt: new Date(Date.now() + dto.expiresInHours * 3600_000),
          createdById: user.id,
          media: mediaIds.length ? { createMany: { data: mediaIds.map((mediaId) => ({ mediaId })) } } : undefined,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'SHARE_LINK_CREATED',
          entityType: 'SHARE_LINK',
          entityId: l.id,
          metadata: { eventId, mediaCount: mediaIds.length, expiresAt: l.expiresAt.toISOString(), allowDownload: dto.allowDownload, password: !!dto.password },
          meta,
        },
        tx,
      );
      return l;
    });
    return { ...this.summary({ ...link, media: mediaIds.map(() => null) }), url: this.url(token) };
  }

  private summary(l: { id: string; title: string; tokenPrefix: string; eventId: string | null; passwordHash: string | null; allowDownload: boolean; expiresAt: Date; revokedAt: Date | null; viewCount: number; downloadCount: number; lastViewedAt: Date | null; createdAt: Date; media?: unknown[] }) {
    const now = new Date();
    return {
      id: l.id,
      title: l.title,
      tokenPrefix: l.tokenPrefix,
      eventId: l.eventId,
      mediaCount: l.media?.length ?? null,
      hasPassword: !!l.passwordHash,
      allowDownload: l.allowDownload,
      expiresAt: l.expiresAt,
      revokedAt: l.revokedAt,
      status: l.revokedAt ? 'REVOKED' : l.expiresAt < now ? 'EXPIRED' : 'ACTIVE',
      viewCount: l.viewCount,
      downloadCount: l.downloadCount,
      lastViewedAt: l.lastViewedAt,
      createdAt: l.createdAt,
    };
  }

  async list(user: AuthUser, eventId?: string) {
    this.assertEnabled();
    const rows = await this.prisma.shareLink.findMany({
      where: { eventId, ...(this.policy.isAdmin(user) ? {} : { createdById: user.id }) },
      include: { media: { select: { mediaId: true } }, createdBy: { select: { id: true, fullName: true } }, event: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...this.summary(r), createdBy: r.createdBy, event: r.event }));
  }

  async revoke(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const l = await this.prisma.shareLink.findUnique({ where: { id } });
    if (!l) throw notFound('Share link');
    if (!this.policy.canManageShareLink(user, l)) throw forbidden();
    await this.prisma.shareLink.update({ where: { id }, data: { revokedAt: l.revokedAt ?? new Date() } });
    await this.audit.record({ actorId: user.id, action: 'SHARE_LINK_REVOKED', entityType: 'SHARE_LINK', entityId: id, meta });
  }

  // ───────────── outsiders ─────────────

  private async resolve(token: string): Promise<LinkRow> {
    this.assertEnabled();
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('Share link');
    const l = await this.prisma.shareLink.findUnique({
      where: { tokenHash: sha256(token) },
      include: { event: { select: { id: true, title: true, eventDate: true, endDate: true, deletedAt: true } } },
    });
    if (!l) throw notFound('Share link');
    if (l.revokedAt || l.expiresAt < new Date() || l.event?.deletedAt) throw gone();
    return l;
  }

  /** Unlock cookie value: "<exp>.<hmac>", bound to the link id. */
  private unlockValue(linkId: string, exp: number): string {
    const mac = createHmac('sha256', this.env.JWT_ACCESS_SECRET).update(`share:${linkId}:${exp}`).digest('base64url');
    return `${exp}.${mac}`;
  }

  unlockCookieName(linkId: string): string {
    return `wcc_share_${linkId.replace(/-/g, '').slice(0, 16)}`;
  }

  private isUnlocked(l: LinkRow, cookies: Record<string, string | undefined>): boolean {
    if (!l.passwordHash) return true;
    const v = cookies[this.unlockCookieName(l.id)];
    if (!v) return false;
    const exp = Number(v.split('.')[0]);
    return exp > Date.now() / 1000 && safeEqual(v, this.unlockValue(l.id, exp));
  }

  private assertUnlocked(l: LinkRow, cookies: Record<string, string | undefined>): void {
    if (!this.isUnlocked(l, cookies)) throw new AppException(HttpStatus.UNAUTHORIZED, 'SHARE_LOCKED', 'Enter the password to view');
  }

  async view(token: string, cookies: Record<string, string | undefined>) {
    const l = await this.resolve(token);
    const unlocked = this.isUnlocked(l, cookies);
    if (unlocked) await this.prisma.shareLink.update({ where: { id: l.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });
    return {
      title: l.title,
      eventDate: l.event ? fromDateOnly(l.event.eventDate) : null,
      endDate: l.event ? fromDateOnly(l.event.endDate) : null,
      expiresAt: l.expiresAt,
      requiresPassword: !!l.passwordHash,
      unlocked,
      allowDownload: l.allowDownload,
    };
  }

  async unlock(token: string, password: string, meta: ReqMeta): Promise<{ name: string; value: string; expires: Date }> {
    const l = await this.resolve(token);
    if (!l.passwordHash) throw badRequest('NO_PASSWORD', 'This link has no password');
    if (!(await this.passwords.verify(l.passwordHash, password))) {
      await this.audit.record({ action: 'SHARE_LINK_BAD_PASSWORD', entityType: 'SHARE_LINK', entityId: l.id, meta });
      throw new AppException(HttpStatus.UNAUTHORIZED, 'WRONG_PASSWORD', 'That password is not right');
    }
    const expires = new Date(Math.min(l.expiresAt.getTime(), Date.now() + 12 * 3600_000));
    return { name: this.unlockCookieName(l.id), value: this.unlockValue(l.id, Math.floor(expires.getTime() / 1000)), expires };
  }

  private mediaWhere(l: LinkRow): Prisma.MediaAssetWhereInput {
    return {
      deletedAt: null,
      status: 'READY',
      event: { deletedAt: null },
      ...(l.eventId ? { eventId: l.eventId } : { shareItems: { some: { shareLinkId: l.id } } }),
    };
  }

  async media(token: string, cookies: Record<string, string | undefined>, cursor?: string, limit?: number) {
    const l = await this.resolve(token);
    this.assertUnlocked(l, cookies);
    const take = clampLimit(limit);
    const rows = await this.prisma.mediaAsset.findMany({
      where: this.mediaWhere(l),
      include: { variants: { select: { kind: true, key: true } } },
      orderBy: [{ takenAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: Buffer.from(cursor, 'base64url').toString() }, skip: 1 } : {}),
    });
    const page = rows.slice(0, take);
    const items = await Promise.all(
      page.map(async (m) => {
        // Outsiders get variants only; originals only through the download endpoint.
        const urls = await this.delivery.mediaUrls({ type: m.type, originalKey: m.originalKey, variants: m.variants }, 'public');
        const hasPreviewVideo = m.variants.some((v) => v.kind === 'VIDEO_PREVIEW');
        return {
          id: m.id,
          type: m.type,
          width: m.width,
          height: m.height,
          durationSec: m.durationSec ? Number(m.durationSec) : null,
          caption: m.caption,
          thumbUrl: urls.thumbUrl,
          previewUrl: urls.previewUrl,
          posterUrl: urls.posterUrl,
          playbackUrl: hasPreviewVideo || l.allowDownload ? urls.playbackUrl : null,
        };
      }),
    );
    return { items, nextCursor: rows.length > take ? Buffer.from(page[page.length - 1]!.id).toString('base64url') : null };
  }

  async download(token: string, mediaId: string, cookies: Record<string, string | undefined>, meta: ReqMeta): Promise<string> {
    const l = await this.resolve(token);
    this.assertUnlocked(l, cookies);
    if (!l.allowDownload) throw forbidden('Downloads are turned off for this link');
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, ...this.mediaWhere(l) } });
    if (!m) throw notFound('Media');
    await this.prisma.shareLink.update({ where: { id: l.id }, data: { downloadCount: { increment: 1 } } });
    await this.audit.record({ action: 'SHARE_MEDIA_DOWNLOADED', entityType: 'SHARE_LINK', entityId: l.id, metadata: { mediaId }, meta });
    return this.delivery.downloadUrl(m.originalKey, m.originalFilename);
  }

  /** "Download all" as a ZIP for the family (§19). Reuses a recent export of the same link. */
  async requestZip(token: string, cookies: Record<string, string | undefined>, meta: ReqMeta) {
    const l = await this.resolve(token);
    this.assertUnlocked(l, cookies);
    if (!l.allowDownload) throw forbidden('Downloads are turned off for this link');
    const recent = await this.prisma.exportJob.findFirst({
      where: { shareLinkId: l.id, status: { in: ['PENDING', 'RUNNING', 'READY'] }, expiresAt: { gt: new Date(Date.now() + 3600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) return { exportId: recent.id, status: recent.status };
    const ids = (await this.prisma.mediaAsset.findMany({ where: this.mediaWhere(l), select: { id: true }, take: 2000 })).map((m) => m.id);
    if (!ids.length) throw badRequest('EMPTY', 'Nothing to download yet');
    const job = await this.prisma.exportJob.create({
      data: { shareLinkId: l.id, mediaIds: ids, title: l.title, expiresAt: new Date(Math.min(l.expiresAt.getTime(), Date.now() + 24 * 3600_000)) },
    });
    await this.queue.exportZip({ exportId: job.id });
    await this.audit.record({ action: 'SHARE_ZIP_REQUESTED', entityType: 'SHARE_LINK', entityId: l.id, metadata: { files: ids.length }, meta });
    return { exportId: job.id, status: job.status };
  }

  async zipStatus(token: string, exportId: string, cookies: Record<string, string | undefined>) {
    const l = await this.resolve(token);
    this.assertUnlocked(l, cookies);
    const job = await this.prisma.exportJob.findFirst({ where: { id: exportId, shareLinkId: l.id } });
    if (!job) throw notFound('Export');
    const downloadUrl =
      job.status === 'READY' && job.key && job.expiresAt > new Date() ? await this.delivery.downloadUrl(job.key, `${job.title.replace(/[^\w\- ]+/g, '').trim() || 'photos'}.zip`) : null;
    return { status: job.status, fileCount: job.fileCount, sizeBytes: job.sizeBytes.toString(), downloadUrl, error: job.status === 'FAILED' ? 'The ZIP could not be built' : null };
  }
}
