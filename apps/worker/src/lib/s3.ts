import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';

/** Variants are immutable: their keys never change for a given original (§8.3). */
const IMMUTABLE = 'private, max-age=31536000, immutable';

export const s3 = new S3Client({
  region: env.AWS_REGION,
  endpoint: env.S3_ENDPOINT || undefined,
  forcePathStyle: !!env.S3_ENDPOINT,
  credentials:
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
      : undefined,
});
export const bucket = env.S3_BUCKET;

export async function getStream(key: string): Promise<Readable> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return out.Body as Readable;
}

export async function download(key: string, dest: string): Promise<void> {
  await pipeline(await getStream(key), createWriteStream(dest));
}

/** The first bytes of an object, for magic-byte checks without downloading it. */
export async function head(key: string, bytes = 4100): Promise<Buffer> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
  const chunks: Buffer[] = [];
  for await (const c of out.Body as Readable) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

/** ffmpeg/ffprobe read the original over HTTPS (range requests) — no 20 GB download to disk. */
export function signedGet(key: string, expiresIn = 6 * 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function putFile(key: string, file: string, contentType: string): Promise<number> {
  const { size } = await stat(file);
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(file), ContentType: contentType, ContentLength: size, CacheControl: IMMUTABLE }),
  );
  return size;
}

export async function putBuffer(key: string, body: Buffer, contentType: string): Promise<number> {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: IMMUTABLE }));
  return body.length;
}

export async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (chunk.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
  }
}
