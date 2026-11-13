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
    /** Members, groups and attendance */
    canViewMembership: boolean;
    canManageMembership: boolean;
    canCreateGroup: boolean;
    canRecordSunday: boolean;
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

// ---------------------------------------------------------------- Membership & attendance

export interface PastorDto {
  id: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  email: string;
}

export interface GroupDto {
  id: string;
  type: 'CONSTITUENCY' | 'BASONTA';
  name: string;
  description: string | null;
  meetingDay: string | null;
  meetingPlace: string | null;
  isActive: boolean;
  pastor: PastorDto | null;
  memberCount: number;
  lastMeeting: { date: string; present: number } | null;
  canManage: boolean;
}

export interface MemberDto {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  location: string | null;
  churchRole: string;
  joinedOn: string | null;
  isActive: boolean;
  notes: string | null;
  constituency: { id: string; name: string } | null;
  basontas: Array<{ id: string; name: string }>;
  lastSeen: string | null;
  canEdit: boolean;
}

export interface AttendanceSheetDto {
  session: {
    id: string;
    visitorCount: number;
    firstTimerCount: number;
    notes: string | null;
    title: string | null;
    recordedBy: string | null;
    updatedAt: string;
  } | null;
  kind: 'SUNDAY_SERVICE' | 'GROUP_MEETING';
  group: { id: string; name: string; type: 'CONSTITUENCY' | 'BASONTA' } | null;
  date: string;
  roster: Array<{ id: string; fullName: string; churchRole: string; constituency: string | null; constituencyId: string | null }>;
  presentIds: string[];
  canEdit: boolean;
}

export interface AttendanceSummaryDto {
  from: string;
  to: string;
  activeMembers: number;
  sundays: Array<{
    id: string;
    date: string;
    present: number;
    visitors: number;
    firstTimers: number;
    byConstituency: Record<string, number>;
  }>;
  constituencies: Array<{ id: string; name: string; members: number }>;
  groups: Array<{
    id: string;
    type: 'CONSTITUENCY' | 'BASONTA';
    name: string;
    pastor: string | null;
    members: number;
    meetings: number;
    averagePresent: number;
    lastMeeting: string | null;
  }>;
  absentees: Array<{ id: string; fullName: string; phone: string | null; constituency: string | null; lastSeen: string | null }>;
}
