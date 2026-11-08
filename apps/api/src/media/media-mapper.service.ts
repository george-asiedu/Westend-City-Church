import { Injectable } from '@nestjs/common';
import type { MediaDto } from '@wcc/shared';
import { Prisma } from '@wcc/db';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PolicyService } from '../policy/policy.service';
import type { AuthUser } from '../common/auth-user';

export const MEDIA_INCLUDE = {
  variants: { select: { kind: true, key: true } },
  tags: { select: { tag: { select: { name: true } } } },
  uploadedBy: { select: { id: true, fullName: true } },
  event: { select: { categoryId: true } },
} satisfies Prisma.MediaAssetInclude;

export type MediaRow = Prisma.MediaAssetGetPayload<{ include: typeof MEDIA_INCLUDE }>;

/** Shapes media rows for the API and resolves their URLs through DeliveryService. */
@Injectable()
export class MediaMapper {
  constructor(private readonly delivery: DeliveryService, private readonly policy: PolicyService, private readonly prisma: PrismaService) {}

  async toDto(m: MediaRow, user: AuthUser): Promise<MediaDto> {
    const ready = m.status === 'READY';
    const urls = ready
      ? await this.delivery.mediaUrls({ type: m.type, originalKey: m.originalKey, variants: m.variants })
      : { thumbUrl: null, previewUrl: null, posterUrl: null, playbackUrl: null };
    const like = { uploadedById: m.uploadedById, categoryId: m.event.categoryId };
    return {
      id: m.id,
      eventId: m.eventId,
      type: m.type,
      status: m.status,
      originalFilename: m.originalFilename,
      sizeBytes: m.sizeBytes.toString(),
      width: m.width,
      height: m.height,
      durationSec: m.durationSec ? Number(m.durationSec) : null,
      caption: m.caption,
      isFeatured: m.isFeatured,
      takenAt: m.takenAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      processingError: m.status === 'FAILED' ? m.processingError : null,
      uploadedBy: m.uploadedBy,
      ...urls,
      tags: m.tags.map((t) => t.tag.name),
      canEdit: this.policy.canEditMedia(user, like),
      canDelete: this.policy.canDeleteMedia(user, like),
    };
  }

  toDtos(rows: MediaRow[], user: AuthUser): Promise<MediaDto[]> {
    return Promise.all(rows.map((r) => this.toDto(r, user)));
  }

  /** mediaId → thumbnail URL, for event/category covers. */
  async thumbUrls(mediaIds: Array<string | null | undefined>): Promise<Map<string, string>> {
    const ids = [...new Set(mediaIds.filter((x): x is string => !!x))];
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const variants = await this.prisma.mediaVariant.findMany({
      where: { mediaId: { in: ids }, kind: { in: ['THUMB', 'POSTER'] }, media: { status: 'READY', deletedAt: null } },
      select: { mediaId: true, kind: true, key: true },
    });
    for (const v of variants.sort((a) => (a.kind === 'THUMB' ? -1 : 1)))
      if (!out.has(v.mediaId)) out.set(v.mediaId, await this.delivery.urlFor(v.key));
    return out;
  }
}
