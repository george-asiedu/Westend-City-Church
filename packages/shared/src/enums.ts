// Mirrors the Prisma enums so the web app never imports @prisma/client.
export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  MEDIA_ADMIN: 'MEDIA_ADMIN',
  MEDIA_TEAM: 'MEDIA_TEAM',
  PASTOR: 'PASTOR',
  VIEWER: 'VIEWER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role);
export const ADMIN_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.MEDIA_ADMIN];

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
  MEDIA_ADMIN: 'Media Admin',
  MEDIA_TEAM: 'Media Team',
  PASTOR: 'Pastor',
  VIEWER: 'Viewer',
};

/** Permissions a Super Admin can grant to other roles (Super Admin always has them). */
export const ROLE_PERMISSIONS = {
  MANAGE_CATEGORIES: 'MANAGE_CATEGORIES',
} as const;
export type RolePermissionKey = (typeof ROLE_PERMISSIONS)[keyof typeof ROLE_PERMISSIONS];
export const ROLE_PERMISSION_LABELS: Record<RolePermissionKey, string> = {
  MANAGE_CATEGORIES: 'Add, edit and delete folders',
};
