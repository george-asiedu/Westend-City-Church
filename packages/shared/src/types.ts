import type { EventStatus, MediaStatus, MediaType, Role, UserStatus } from './enums';

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CategoryGrant {
  categoryId: string;
  canView: boolean;
  canUpload: boolean;
  canManage: boolean;
}

export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
  totpEnabled: boolean;
  mustEnable2fa: boolean;
  grants: CategoryGrant[];
  permissions: {
    isAdmin: boolean;
    canUploadAnywhere: boolean;
    canInvite: boolean;
    canManageCategories: boolean;
    canManageRolePermissions: boolean;
    canViewAudit: boolean;
    canPurge: boolean;
  };
}

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  allowsMultiDay: boolean;
  isActive: boolean;
  eventCount: number;
  latestEventDate: string | null;
  coverThumbUrl: string | null;
}

export interface EventDto {
  id: string;
  categoryId: string;
  category: { id: string; slug: string; name: string; allowsMultiDay: boolean };
  title: string;
  slug: string;
  eventDate: string;
  endDate: string | null;
  programType: string | null;
  location: string | null;
  description: string | null;
  status: EventStatus;
  mediaCount: number;
  photoCount: number;
  videoCount: number;
  totalBytes: string;
  coverMediaId: string | null;
  coverThumbUrl: string | null;
  createdBy: { id: string; fullName: string };
  createdAt: string;
  canEdit?: boolean;
  canDelete?: boolean;
  canUpload?: boolean;
  canShare?: boolean;
}

export interface MediaDto {
  id: string;
  eventId: string;
  type: MediaType;
  status: MediaStatus;
  originalFilename: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  caption: string | null;
  isFeatured: boolean;
  takenAt: string | null;
  createdAt: string;
  processingError: string | null;
  uploadedBy: { id: string; fullName: string };
  thumbUrl: string | null;
  previewUrl: string | null;
  posterUrl: string | null;
  playbackUrl: string | null;
  tags: string[];
  canEdit: boolean;
  canDelete: boolean;
}
