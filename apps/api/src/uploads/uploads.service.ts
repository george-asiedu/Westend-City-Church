import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { classifyUpload, extensionOf, keys, sanitizeFilename, GB, MB, RAW_MIME_FALLBACK, type FileKind } from '@wcc/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { StorageService } from '../storage/storage.service';
import { EventsService } from '../events/events.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

export interface InitFile {
  clientId: string;
  filename: string;
  size: number;
  mimeType: string;
}

export type InitResult =
  | { clientId: string; mediaId: string; strategy: 'single'; putUrl: string; headers: Record<string, string> }
  | { clientId: string; mediaId: string; strategy: 'multipart'; uploadId: string; partSize: number; key: string }
  | { clientId: string; error: { code: string; message: string } };

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private maxBytes(kind: FileKind): number {
    if (kind === 'VIDEO') return this.env.MAX_VIDEO_GB * GB;
    if (kind === 'RAW') return this.env.MAX_RAW_MB * MB;
    return this.env.MAX_IMAGE_MB * MB;
  }

  async init(user: AuthUser, eventId: string, files: InitFile[], meta: ReqMeta): Promise<InitResult[]> {
    const event = await this.events.load(user, eventId);
    if (!this.policy.canUploadToEvent(user, event)) throw forbidden('You cannot upload to this event');
    if (files.length > this.env.MAX_FILES_PER_INIT) throw badRequest('TOO_MANY_FILES', `At most ${this.env.MAX_FILES_PER_INIT} files per request`);

    const threshold = this.env.S3_MULTIPART_THRESHOLD_MB * MB;
    const partSize = this.env.S3_PART_SIZE_MB * MB;
    const results: InitResult[] = [];

    for (const f of files) {
      const filename = sanitizeFilename(f.filename);
      const kind = classifyUpload(filename, f.mimeType);
      if (!kind) {
        results.push({ clientId: f.clientId, error: { code: 'TYPE_NOT_ALLOWED', message: `${filename}: this file type is not allowed` } });
        continue;
      }
      if (f.size <= 0 || f.size > this.maxBytes(kind)) {
        results.push({ clientId: f.clientId, error: { code: 'TOO_LARGE', message: `${filename}: file is empty or too large` } });
        continue;
      }
      const mediaId = randomUUID();
      // The server builds the key (§8.2); the client name is display-only.
      const key = keys.original(event.id, mediaId, extensionOf(filename).replace(/[^a-z0-9.]/g, ''));
      const contentType = kind === 'RAW' ? (f.mimeType && f.mimeType !== 'application/octet-stream' ? f.mimeType : RAW_MIME_FALLBACK) : f.mimeType || 'image/heic';
      const multipart = f.size > threshold;
      const uploadId = multipart ? await this.storage.createMultipart(key, contentType) : null;
      await this.prisma.mediaAsset.create({
        data: {
          id: mediaId,
          eventId: event.id,
          uploadedById: user.id,
          type: kind === 'VIDEO' ? 'VIDEO' : 'IMAGE',
          isRaw: kind === 'RAW',
          originalFilename: filename,
          originalKey: key,
          mimeType: contentType,
          sizeBytes: BigInt(f.size),
          s3UploadId: uploadId,
        },
      });
      if (uploadId) results.push({ clientId: f.clientId, mediaId, strategy: 'multipart', uploadId, partSize, key });
      else
        results.push({
          clientId: f.clientId,
          mediaId,
          strategy: 'single',
          putUrl: await this.storage.presignPut(key, contentType, f.size),
          headers: { 'Content-Type': contentType },
        });
    }
    const accepted = results.filter((r) => 'mediaId' in r).length;
    if (accepted)
      await this.audit.record({ actorId: user.id, action: 'UPLOAD_STARTED', entityType: 'EVENT', entityId: event.id, metadata: { files: accepted }, meta });
    return results;
  }

  /** Only the uploader may drive their pending upload (§10.6). */
  private async pending(user: AuthUser, mediaId: string) {
    const m = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!m || m.uploadedById !== user.id) throw notFound('Upload');
    if (m.status !== 'PENDING_UPLOAD') throw badRequest('NOT_PENDING', 'This upload is already complete');
    return m;
  }

  async signParts(user: AuthUser, mediaId: string, partNumbers: number[]) {
    const m = await this.pending(user, mediaId);
    if (!m.s3UploadId) throw badRequest('NOT_MULTIPART', 'Not a multipart upload');
    const maxPart = Math.ceil(Number(m.sizeBytes) / (this.env.S3_PART_SIZE_MB * MB)) + 1;
    return Promise.all(
      partNumbers.map(async (partNumber) => {
        if (partNumber < 1 || partNumber > Math.min(10_000, maxPart)) throw badRequest('BAD_PART', 'Invalid part number');
        return { partNumber, url: await this.storage.presignPart(m.originalKey, m.s3UploadId!, partNumber) };
      }),
    );
  }

  /** Fresh single-PUT URL: a long queue can outlive the 15-minute URL from /init. */
  async putUrl(user: AuthUser, mediaId: string) {
    const m = await this.pending(user, mediaId);
    if (m.s3UploadId) throw badRequest('IS_MULTIPART', 'Multipart uploads sign parts instead');
    return { url: await this.storage.presignPut(m.originalKey, m.mimeType, Number(m.sizeBytes)), headers: { 'Content-Type': m.mimeType } };
  }

  async listParts(user: AuthUser, mediaId: string) {
    const m = await this.pending(user, mediaId);
    if (!m.s3UploadId) return [];
    return (await this.storage.listParts(m.originalKey, m.s3UploadId)).map((p) => ({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size }));
  }

  async complete(user: AuthUser, mediaId: string, parts: Array<{ partNumber: number; etag: string }>) {
    const m = await this.pending(user, mediaId);
    if (!m.s3UploadId) throw badRequest('NOT_MULTIPART', 'Not a multipart upload');
    await this.storage.completeMultipart(m.originalKey, m.s3UploadId, parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })));
    return this.verifyAndQueue(m.id);
  }

  async finalize(user: AuthUser, mediaId: string) {
    const m = await this.pending(user, mediaId);
    if (m.s3UploadId) throw badRequest('IS_MULTIPART', 'Use /complete for multipart uploads');
    return this.verifyAndQueue(m.id);
  }

  private async verifyAndQueue(mediaId: string) {
    const m = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } });
    const head = await this.storage.head(m.originalKey);
    if (!head) throw badRequest('NOT_UPLOADED', 'The file has not reached storage yet');
    if (BigInt(head.size) !== m.sizeBytes) {
      await this.storage.deleteKeys([m.originalKey]);
      await this.prisma.mediaAsset.delete({ where: { id: m.id } });
      throw badRequest('SIZE_MISMATCH', 'The uploaded file size does not match');
    }
    const res = await this.prisma.mediaAsset.updateMany({ where: { id: m.id, status: 'PENDING_UPLOAD' }, data: { status: 'UPLOADED', s3UploadId: null } });
    if (res.count === 1) await this.queue.processMedia(m.type, { mediaId: m.id }, m.processingAttempts);
    return { mediaId: m.id, status: 'UPLOADED' as const };
  }

  async abort(user: AuthUser, mediaId: string): Promise<void> {
    const m = await this.pending(user, mediaId);
    if (m.s3UploadId) await this.storage.abortMultipart(m.originalKey, m.s3UploadId);
    else await this.storage.deleteKeys([m.originalKey]).catch(() => undefined);
    await this.prisma.mediaAsset.delete({ where: { id: m.id } });
  }
}
