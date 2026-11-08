import { Inject, Injectable } from '@nestjs/common';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV, Env } from '../config/env';

/** The only module that talks to S3 (§17.4). */
@Injectable()
export class StorageService {
  readonly s3: S3Client;
  readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      region: env.AWS_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: !!env.S3_ENDPOINT,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  /** Content-Type and Content-Length are signed, so the client cannot swap them (§8.2). */
  presignPut(key: string, contentType: string, contentLength: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      { expiresIn: 15 * 60, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const out = await this.s3.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    if (!out.UploadId) throw new Error('S3 returned no UploadId');
    return out.UploadId;
  }

  presignPart(key: string, uploadId: string, partNumber: number): Promise<string> {
    return getSignedUrl(
      this.s3,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: 15 * 60 },
    );
  }

  async listParts(key: string, uploadId: string): Promise<Array<{ PartNumber: number; ETag: string; Size: number }>> {
    const parts: Array<{ PartNumber: number; ETag: string; Size: number }> = [];
    let marker: string | undefined;
    do {
      const out = await this.s3.send(
        new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
      );
      for (const p of out.Parts ?? [])
        if (p.PartNumber && p.ETag) parts.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 });
      marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeMultipart(key: string, uploadId: string, parts: Array<{ PartNumber: number; ETag: string }>): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => undefined);
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const out = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: out.ContentLength ?? 0, contentType: out.ContentType };
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  /**
   * Presigned GET. `signingDate` is rounded down so the same object yields the
   * same URL for a while — browsers can then cache gallery thumbnails.
   */
  presignGet(key: string, opts: { expiresIn: number; downloadName?: string; roundToSec?: number }): Promise<string> {
    const round = opts.roundToSec ?? 0;
    const signingDate = round ? new Date(Math.floor(Date.now() / (round * 1000)) * round * 1000) : undefined;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: opts.downloadName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`
          : undefined,
      }),
      { expiresIn: opts.expiresIn + round, signingDate },
    );
  }

  async deleteKeys(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      if (chunk.length)
        await this.s3.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }),
        );
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
