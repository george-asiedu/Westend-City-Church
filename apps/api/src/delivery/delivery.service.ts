import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { getSignedCookies, getSignedUrl } from '@aws-sdk/cloudfront-signer';
import type { VariantKind } from '@wcc/db';
import { ENV, Env } from '../config/env';
import { StorageService } from '../storage/storage.service';

export interface VariantRef {
  kind: VariantKind;
  key: string;
}

export interface MediaUrls {
  thumbUrl: string | null;
  previewUrl: string | null;
  posterUrl: string | null;
  playbackUrl: string | null;
}

/**
 * Turns S3 keys into URLs the browser can load. The web app never builds
 * media URLs itself (§8.4), so switching from `s3-presign` (no custom domain
 * needed) to `cloudfront` (once the domain is live) is only an env change.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  private privateKey: string | null = null;

  constructor(@Inject(ENV) private readonly env: Env, private readonly storage: StorageService) {
    if (env.MEDIA_DELIVERY_MODE === 'cloudfront') {
      this.privateKey = readFileSync(env.CLOUDFRONT_PRIVATE_KEY_PATH, 'utf8');
    }
  }

  get mode(): Env['MEDIA_DELIVERY_MODE'] {
    return this.env.MEDIA_DELIVERY_MODE;
  }

  private cdnUrl(key: string): string {
    return `https://${this.env.CLOUDFRONT_DOMAIN}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** URL for a signed-in user (CloudFront cookie mode: plain URL; dev: presigned GET, ~1 h). */
  async urlFor(key: string): Promise<string> {
    if (this.mode === 'cloudfront') return this.cdnUrl(key);
    return this.storage.presignGet(key, { expiresIn: 3600, roundToSec: 1800 });
  }

  /** URL for an outsider (share links / public highlights): self-contained signature, no cookies. */
  async publicUrlFor(key: string, ttlSec = 3600): Promise<string> {
    if (this.mode === 'cloudfront' && this.privateKey) {
      const bucket = Math.floor(Date.now() / 1_800_000) * 1800 + ttlSec + 1800; // stable for 30 min
      return getSignedUrl({
        url: this.cdnUrl(key),
        keyPairId: this.env.CLOUDFRONT_KEY_PAIR_ID,
        privateKey: this.privateKey,
        dateLessThan: new Date(bucket * 1000).toISOString(),
      });
    }
    return this.storage.presignGet(key, { expiresIn: ttlSec, roundToSec: 1800 });
  }

  async mediaUrls(
    m: { type: 'IMAGE' | 'VIDEO'; originalKey: string; variants: VariantRef[]; isRaw?: boolean },
    audience: 'member' | 'public' = 'member',
  ): Promise<MediaUrls> {
    const sign = (k: string) => (audience === 'public' ? this.publicUrlFor(k) : this.urlFor(k));
    const byKind = new Map(m.variants.map((v) => [v.kind, v.key]));
    const thumb = byKind.get('THUMB') ?? byKind.get('POSTER');
    const preview = byKind.get('PREVIEW') ?? byKind.get('POSTER');
    const poster = byKind.get('POSTER');
    // Prefer the 720p preview; otherwise the original is browser-friendly enough to play.
    const playback = m.type === 'VIDEO' ? (byKind.get('VIDEO_PREVIEW') ?? m.originalKey) : null;
    const [thumbUrl, previewUrl, posterUrl, playbackUrl] = await Promise.all([
      thumb ? sign(thumb) : null,
      preview ? sign(preview) : null,
      poster ? sign(poster) : null,
      playback ? sign(playback) : null,
    ]);
    return { thumbUrl, previewUrl, posterUrl, playbackUrl };
  }

  /** 5-minute attachment download of an original (§8.4, D3). */
  downloadUrl(key: string, filename: string): Promise<string> {
    return this.storage.presignGet(key, { expiresIn: 300, downloadName: filename });
  }

  /** CloudFront signed cookies (custom policy for media/*), or null in presign mode. */
  cdnCookies(): { cookies: Record<string, string>; expiresAt: Date } | null {
    if (this.mode !== 'cloudfront' || !this.privateKey) return null;
    const expiresAt = new Date(Date.now() + this.env.CDN_COOKIE_TTL_MIN * 60_000);
    const policy = JSON.stringify({
      Statement: [
        {
          Resource: `https://${this.env.CLOUDFRONT_DOMAIN}/media/*`,
          Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor(expiresAt.getTime() / 1000) } },
        },
      ],
    });
    const signed = getSignedCookies({ keyPairId: this.env.CLOUDFRONT_KEY_PAIR_ID, privateKey: this.privateKey, policy });
    return { cookies: signed as unknown as Record<string, string>, expiresAt };
  }
}
