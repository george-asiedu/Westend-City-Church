/** BullMQ queue names and job payloads shared by the API (producer) and worker (consumer). */
export const QUEUES = {
  IMAGE: 'media-image',
  VIDEO: 'media-video',
  DELETE: 'media-delete',
  MAINTENANCE: 'maintenance',
  MAIL: 'mail',
  EXPORT: 'export',
  NOTIFY: 'notify',
} as const;

/** Push-notification jobs. Reminders and stats run on a weekly schedule in the worker. */
export const NOTIFY_JOBS = {
  ATTENDANCE_REMINDER: 'attendance-reminder',
  WEEKEND_STATS: 'weekend-stats',
  TEST: 'test',
} as const;
export interface NotifyTestJob {
  userId: string;
}
/** What the service worker shows. */
export interface PushPayload {
  title: string;
  body: string;
  /** Relative URL opened on tap. */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag?: string;
}

export interface ProcessMediaJob {
  mediaId: string;
}
export interface PurgeMediaJob {
  mediaId: string;
  /** Keys to delete even if the DB row is already gone. */
  keys?: string[];
}
export interface ExportJobData {
  exportId: string;
}

export type MailTemplate =
  | 'invite'
  | 'password-reset'
  | '2fa-enabled'
  | 'export-ready'
  | 'email-change-verify'
  | 'email-change-requested'
  | 'email-changed';
export interface MailJob {
  to: string;
  template: MailTemplate;
  data: Record<string, string>;
}

export const MAINTENANCE_JOBS = {
  PURGE_TRASH: 'purge-trash',
  ABORT_STALE_UPLOADS: 'abort-stale-uploads',
  RECONCILE_COUNTERS: 'reconcile-counters',
  PRUNE_SESSIONS: 'prune-sessions',
  PRUNE_AUDIT: 'prune-audit',
  PURGE_EXPORTS: 'purge-exports',
} as const;

/** S3 key layout (§9.3). Keys are opaque — never parse ids out of them. */
export const keys = {
  original: (eventId: string, mediaId: string, ext: string) => `media/${eventId}/${mediaId}/original${ext}`,
  variant: (originalKey: string, file: string) => originalKey.replace(/original(\.[^/]*)?$/, file),
  export: (jobId: string) => `exports/${jobId}.zip`,
};

export const VARIANT_FILES = {
  THUMB: 'thumb.webp',
  PREVIEW: 'preview.webp',
  POSTER: 'poster.jpg',
  VIDEO_PREVIEW: 'preview-720p.mp4',
} as const;
