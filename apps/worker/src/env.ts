import { z } from 'zod';
import { cpus } from 'node:os';

const bool = (d: 'true' | 'false') =>
  z.enum(['true', 'false', '1', '0']).default(d).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_PREFIX: z.string().default('wcc'),
  WEB_ORIGIN: z.string().url(),

  AWS_REGION: z.string().default('eu-west-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string(),
  S3_ENDPOINT: z.string().optional(),

  VIDEO_TRANSCODE_ENABLED: bool('true'),
  VIDEO_TRANSCODE_MAX_DURATION_SEC: z.coerce.number().default(10800),
  FFMPEG_THREADS: z.coerce.number().int().default(Math.max(1, Math.floor(cpus().length / 2))),
  WORKER_TMP_DIR: z.string().default('/var/lib/wcc/tmp'),
  /** Space always left free on the tmp disk (the VPS is shared). */
  WORKER_TMP_RESERVE_GB: z.coerce.number().default(15),
  IMAGE_CONCURRENCY: z.coerce.number().int().default(2),
  VIDEO_CONCURRENCY: z.coerce.number().int().default(1),
  EXPORT_MAX_GB: z.coerce.number().default(10),

  TRASH_RETENTION_DAYS: z.coerce.number().default(30),
  AUDIT_RETENTION_DAYS: z.coerce.number().default(730),

  /** Plunk (https://useplunk.com) secret key — the email provider, as in nichelle-api. */
  PLUNK_SECRET: z.string().optional(),
  PLUNK_API_URL: z.string().url().default('https://next-api.useplunk.com'),
  MAIL_FROM: z.string().default('WCC Media <no-reply@example.org>'),
  MAIL_REPLY_TO: z.string().optional(),
  /** Public https URL of the logo for emails. Defaults to WEB_ORIGIN/logo.png when that is https. */
  MAIL_LOGO_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  APP_NAME: z.string().default('WCC Media — The Life Cathedral'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  // Accept nichelle-api's name for the same key too.
  const r = schema.safeParse({ ...process.env, PLUNK_SECRET: process.env.PLUNK_SECRET || process.env.PLUNK_SECRET_KEY });
  if (!r.success) throw new Error(`Invalid environment:\n${r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return r.data;
}

export const env = loadEnv();
