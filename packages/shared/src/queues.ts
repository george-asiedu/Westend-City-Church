/** BullMQ queue names and job payloads shared by the API (producer) and worker (consumer). */
export const QUEUES = {
  IMAGE: 'media-image',
  VIDEO: 'media-video',
  DELETE: 'media-delete',
  MAINTENANCE: 'maintenance',
  MAIL: 'mail',
  EXPORT: 'export',
  /** Scheduled notification jobs (reminders, stats, birthdays, rotas, monthly report): one at a time. */
  NOTIFY: 'notify',
  /** Instant pushes people are waiting for (announcements, follow-ups, test, remind): never stuck behind a scheduled job. */
  PUSH: 'push',
} as const;

/** Mail priority (BullMQ: lower runs first): sign-in emails before bulk ones like the monthly report. */
export const BULK_MAIL_TEMPLATES = ['monthly-report', 'export-ready'] as const;

/** Push-notification jobs. Reminders and stats run on a weekly schedule in the worker. */
export const NOTIFY_JOBS = {
  ATTENDANCE_REMINDER: 'attendance-reminder',
  WEEKEND_STATS: 'weekend-stats',
  TEST: 'test',
  BIRTHDAYS: 'birthdays',
  /** A Super Admin asked specific basontas to record attendance. */
  REMIND_GROUPS: 'remind-groups',
  /** Send a ready-made payload to some users (announcements, follow-up assignments…). */
  PUSH: 'push',
  /** Scheduled announcements whose time has come. */
  ANNOUNCEMENTS_DUE: 'announcements-due',
  /** Tomorrow's bacenta rota. */
  ROSTER_REMINDERS: 'roster-reminders',
  MONTHLY_REPORT: 'monthly-report',
} as const;
export interface PushJob {
  userIds: string[];
  payload: PushPayload;
  kind: 'reminder' | 'stats' | 'birthday' | 'announcement';
}
export interface RemindGroupsJob {
  date: string;
  groupIds: string[];
  requestedBy: string;
}
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
  | 'monthly-report'
  | 'account-approved'
  | 'password-reset-admin'
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
