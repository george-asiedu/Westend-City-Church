// Mirrors the Prisma enums so the web app never imports @prisma/client.
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  PASTOR: 'PASTOR',
  SHEPHERD: 'SHEPHERD',
  VIEWER: 'VIEWER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);
export const ADMIN_ROLES: readonly Role[] = [Role.SUPER_ADMIN];

export const UserStatus = { INVITED: 'INVITED', ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const MediaType = { IMAGE: 'IMAGE', VIDEO: 'VIDEO' } as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export const MediaStatus = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];

export const VariantKind = {
  THUMB: 'THUMB',
  PREVIEW: 'PREVIEW',
  POSTER: 'POSTER',
  VIDEO_PREVIEW: 'VIDEO_PREVIEW',
} as const;
export type VariantKind = (typeof VariantKind)[keyof typeof VariantKind];

export const EventStatus = { DRAFT: 'DRAFT', PUBLISHED: 'PUBLISHED' } as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const ExportStatus = { PENDING: 'PENDING', RUNNING: 'RUNNING', READY: 'READY', FAILED: 'FAILED' } as const;
export type ExportStatus = (typeof ExportStatus)[keyof typeof ExportStatus];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  PASTOR: 'Pastor',
  SHEPHERD: 'Shepherd',
  VIEWER: 'Member',
};

/** Permissions a Super Admin can grant to other roles (Super Admin always has them). */
export const ROLE_PERMISSIONS = {
  MANAGE_CATEGORIES: 'MANAGE_CATEGORIES',
  VIEW_MEMBERSHIP: 'VIEW_MEMBERSHIP',
  MANAGE_MEMBERSHIP: 'MANAGE_MEMBERSHIP',
} as const;
export type RolePermissionKey = (typeof ROLE_PERMISSIONS)[keyof typeof ROLE_PERMISSIONS];
export const ROLE_PERMISSION_LABELS: Record<RolePermissionKey, string> = {
  MANAGE_CATEGORIES: 'Add, edit and delete folders',
  VIEW_MEMBERSHIP: 'View members, groups and attendance',
  MANAGE_MEMBERSHIP: 'Manage all members, groups and attendance',
};

/** Suggestions for what a session is; any text is allowed (max 40 chars). */
export const SERVICE_TYPE_SUGGESTIONS = [
  'Sunday service',
  'Swollen Sunday',
  'Midweek service',
  'All-night service',
  'Prayer meeting',
  'Camp',
  'Conference',
  'Special service',
  'Outreach',
];
/** Sunday services are recorded per service. */
export const SUNDAY_SERVICE_TITLES = ['1st service', '2nd service'] as const;
/** Service types recorded per service (1st/2nd), with the title chosen from SUNDAY_SERVICE_TITLES. */
export const PER_SERVICE_TYPES = ['Sunday service', 'Swollen Sunday'] as const;
export const isPerServiceType = (serviceType: string): boolean => PER_SERVICE_TYPES.some((t) => t.toLowerCase() === serviceType.trim().toLowerCase());
export const MEETING_TYPE_SUGGESTIONS = ['Meeting', 'Rehearsal', 'Prayer meeting', 'Outreach', 'Retreat', 'Camp'];

export const GUEST_INTENT_LABELS = { VISIT: 'Just visiting', JOINING: 'Wants to join' } as const;
export type GuestIntent = keyof typeof GUEST_INTENT_LABELS;

export const GROUP_TYPE_LABELS = { CONSTITUENCY: 'Constituency', BASONTA: 'Basonta', BACENTA: 'Bacenta' } as const;
export const GROUP_TYPE_PLURALS = { CONSTITUENCY: 'Constituencies', BASONTA: 'Basontas', BACENTA: 'Bacentas' } as const;
/** One-line explanations shown in forms. */
export const GROUP_TYPE_HELP = {
  CONSTITUENCY: 'Led by a head pastor; has basontas under it. Every member belongs to one.',
  BASONTA: 'Inside a constituency. Every member belongs to one basonta.',
  BACENTA: 'A church ministry such as media, choir or ushers. Members can serve in several, each with team roles.',
} as const;
/** Starter team roles offered when a bacenta has none yet. */
export const BACENTA_ROLE_SUGGESTIONS: Record<string, string[]> = {
  media: ['Mixing', 'Projection', 'Camera', 'Live streaming', 'Social media', 'Photography'],
  choir: ['Soprano', 'Alto', 'Tenor', 'Bass', 'Instrumentalist', 'Choir director'],
  ushers: ['Door', 'Seating', 'Offering', 'Protocol'],
  dancing: ['Dancer', 'Choreographer', 'Costumes'],
};
export type GroupType = keyof typeof GROUP_TYPE_LABELS;
/** Suggestions only; any text is allowed. */
export const CHURCH_ROLE_SUGGESTIONS = [
  'Member',
  'New convert',
  'Bacenta leader',
  'Shepherd',
  'Constituency overseer',
  'Basonta leader',
  'Head Usher',
  'Choir',
  'Dancer',
  'Media',
  'Protocol',
  'Pastor',
];

export const FOLLOW_UP_STATUS_LABELS = {
  OPEN: 'To do',
  CONTACTED: 'Contacted',
  VISITED: 'Visited',
  UNREACHABLE: 'Not reachable',
  DONE: 'Done',
} as const;
export const MILESTONE_TYPES = ['Salvation', 'Foundation school', 'Water baptism', 'Holy Spirit baptism', 'Wedding', 'New believers class', 'Ordination'] as const;
export const ROLE_LABEL_MEMBER = 'Member';
