import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().default(4000),
    /** Path prefix the API is served under. The web app proxies /api/* to it, same origin. */
    API_PREFIX: z.string().default('api/v1'),
    /** Public URL of the web app, e.g. https://13-140-180-190.sslip.io or https://media.westendcity.church */
    WEB_ORIGIN: z.string().url(),
    /** Extra allowed origins (comma separated) for the CSRF Origin check. */
    CORS_ORIGINS: z.string().default(''),
    /** Empty = host-only cookies (works without a custom domain). Set ".media.example.org" once the domain is live. */
    COOKIE_DOMAIN: z.string().default(''),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    QUEUE_PREFIX: z.string().default('wcc'),

    JWT_ACCESS_SECRET: z.string().min(64, 'JWT_ACCESS_SECRET must be at least 64 chars'),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().default(14),
    REFRESH_ABSOLUTE_TTL_DAYS: z.coerce.number().int().default(60),
    APP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes, base64'),
    REQUIRE_2FA_FOR_ADMINS: bool.default('true'),
    PWNED_PASSWORD_CHECK: bool,

    AWS_REGION: z.string().default('eu-west-1'),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().min(3),
    /** For local S3-compatible testing (MinIO). Leave empty for AWS. */
    S3_ENDPOINT: z.string().optional(),
    S3_MULTIPART_THRESHOLD_MB: z.coerce.number().default(100),
    S3_PART_SIZE_MB: z.coerce.number().default(16),

    MEDIA_DELIVERY_MODE: z.enum(['s3-presign', 'cloudfront']).default('s3-presign'),
    CLOUDFRONT_DOMAIN: z.string().default(''),
    CLOUDFRONT_KEY_PAIR_ID: z.string().default(''),
    CLOUDFRONT_PRIVATE_KEY_PATH: z.string().default(''),
    CDN_COOKIE_TTL_MIN: z.coerce.number().default(120),

    MAX_IMAGE_MB: z.coerce.number().default(60),
    MAX_RAW_MB: z.coerce.number().default(120),
    MAX_VIDEO_GB: z.coerce.number().default(20),
    MAX_FILES_PER_INIT: z.coerce.number().default(1000),

    TRASH_RETENTION_DAYS: z.coerce.number().default(30),
    SHARE_LINKS_ENABLED: bool.default('true'),
    PUBLIC_HIGHLIGHTS_ENABLED: bool,
    SWAGGER_ENABLED: bool,
    /** Web Push public key (the worker holds the private key). */
    VAPID_PUBLIC_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  })
  .superRefine((v, ctx) => {
    if (v.MEDIA_DELIVERY_MODE === 'cloudfront') {
      for (const k of ['CLOUDFRONT_DOMAIN', 'CLOUDFRONT_KEY_PAIR_ID', 'CLOUDFRONT_PRIVATE_KEY_PATH'] as const) {
        if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required in cloudfront mode` });
      }
      if (!v.COOKIE_DOMAIN)
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_DOMAIN'],
          message: 'cloudfront mode needs COOKIE_DOMAIN (the web app and CDN must share a parent domain)',
        });
    }
    if (v.NODE_ENV === 'production' && !v.WEB_ORIGIN.startsWith('https://'))
      ctx.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'WEB_ORIGIN must be https in production' });
  });

export type Env = z.infer<typeof schema>;
export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Refuse to boot with missing or weak secrets (§13).
    throw new Error(`Invalid environment:\n${lines}`);
  }
  return parsed.data;
}

export function allowedOrigins(env: Env): string[] {
  return [env.WEB_ORIGIN, ...env.CORS_ORIGINS.split(',').map((s) => s.trim())].filter(Boolean);
}
