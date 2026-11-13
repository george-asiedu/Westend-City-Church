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
    /** Church-wide charts and reports */
    canViewChurchStats: boolean;
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

export type GroupTypeKey = 'CONSTITUENCY' | 'BASONTA' | 'BACENTA';
export interface MemberRefDto {
  id: string;
  fullName: string;
  phone: string | null;
}
export interface TeamRoleDto {
  id: string;
  name: string;
}

export interface PastorDto {
  id: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  email: string;
}

export interface GroupDto {
  id: string;
  type: GroupTypeKey;
  name: string;
  description: string | null;
  meetingDay: string | null;
  meetingPlace: string | null;
  isActive: boolean;
  pastor: PastorDto | null;
  shepherds: PastorDto[];
  /** A basonta's constituency (and its head pastor). */
  parent: { id: string; name: string; pastor: PastorDto | null } | null;
  /** A constituency's basontas. */
  children: Array<{ id: string; name: string; pastor: string | null; memberCount: number }>;
  /** A bacenta's team roles, with how many members hold each and the team's lead. */
  roles: Array<TeamRoleDto & { memberCount: number; lead: MemberRefDto | null }>;
  /** A bacenta's overall team lead. */
  lead: MemberRefDto | null;
  memberCount: number;
  lastMeeting: { id: string; date: string; present: number } | null;
  /** Take attendance and manage members (pastor, shepherds, admins). */
  canManage: boolean;
  /** Edit details, delete, assign shepherds (pastor, admins). */
  canAdminister: boolean;
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
  basonta: { id: string; name: string } | null;
  bacentas: Array<{ id: string; name: string; roles: TeamRoleDto[] }>;
  lastSeen: string | null;
  canEdit: boolean;
}

export interface GuestDto {
  id: string;
  fullName: string | null;
  phone: string | null;
  intent: 'VISIT' | 'JOINING';
  broughtBy: { id: string; fullName: string } | null;
  convertedMember: { id: string; fullName: string } | null;
  session?: { id: string; date: string; serviceType: string; title: string | null; group: { id: string; name: string } | null };
}

export interface SessionInfoDto {
  id: string;
  kind: 'CHURCH_SERVICE' | 'GROUP_MEETING';
  serviceType: string;
  title: string | null;
  date: string;
  group: { id: string; name: string; type: GroupTypeKey } | null;
  visitorCount: number;
  firstTimerCount: number;
  notes: string | null;
  recordedBy: string | null;
  updatedAt: string;
}

export interface AttendanceSheetDto {
  session: SessionInfoDto;
  roster: Array<{ id: string; fullName: string; churchRole: string; constituency: string | null; constituencyId: string | null; teamRoles: TeamRoleDto[] }>;
  presentIds: string[];
  /** memberId → people brought (0 = nobody); missing = not recorded */
  brought: Record<string, number>;
  guests: GuestDto[];
  canEdit: boolean;
}

export interface SessionRowDto {
  id: string;
  kind: 'CHURCH_SERVICE' | 'GROUP_MEETING';
  serviceType: string;
  title: string | null;
  date: string;
  group: { id: string; name: string; type: GroupTypeKey } | null;
  present: number;
  visitors: number;
  firstTimers: number;
  guests: number;
}

export interface AttendanceSummaryDto {
  from: string;
  to: string;
  activeMembers: number;
  services: Array<{
    id: string;
    date: string;
    serviceType: string;
    title: string | null;
    present: number;
    visitors: number;
    firstTimers: number;
    guests: number;
    byConstituency: Record<string, number>;
  }>;
  serviceTypes: Array<{ serviceType: string; sessions: number; averagePresent: number }>;
  constituencies: Array<{ id: string; name: string; members: number }>;
  basontas: Array<{ id: string; name: string; members: number }>;
  bacentas: Array<{ id: string; name: string; members: number }>;
  groups: Array<{
    id: string;
    type: GroupTypeKey;
    name: string;
    pastor: string | null;
    members: number;
    meetings: number;
    averagePresent: number;
    lastMeeting: string | null;
  }>;
  guests: { visit: number; joining: number; converted: number; broughtNone: number; broughtSome: number };
  absentees: Array<{ id: string; fullName: string; phone: string | null; constituency: string | null; lastSeen: string | null }>;
}

export interface GroupStatsDto {
  from: string;
  to: string;
  members: number;
  meetings: Array<{ id: string; date: string; serviceType: string; title: string | null; present: number; visitors: number; guests: number }>;
  averagePresent: number;
  lastMeeting: { id: string; date: string; present: number; absent: number } | null;
  roles: Array<{ role: string; count: number }>;
  /** Bacentas: members per team role (plus "No role yet"). */
  teamRoles: Array<{ id: string | null; name: string; count: number }>;
  guests: { visit: number; joining: number; converted: number };
  /** Constituencies: meetings are per-date sums of their basontas. */
  sumOfBasontas: boolean;
  /** Group members at church-wide services in the period */
  churchServices: { sessions: number; averagePresent: number };
}

export interface LeaderDto {
  id: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  email: string;
  role: 'SUPER_ADMIN' | 'PASTOR' | 'SHEPHERD';
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  leads: Array<{ id: string; name: string; type: GroupTypeKey }>;
  shepherds: Array<{ id: string; name: string; type: GroupTypeKey }>;
}

/** One day's attendance by constituency (each the sum of its basontas). */
export interface DayRollupDto {
  date: string;
  total: number;
  constituencies: Array<{
    id: string;
    name: string;
    pastorId: string | null;
    members: number;
    present: number | null;
    recorded: number;
    missing: number;
    basontas: Array<{ id: string; name: string; pastorId: string | null; shepherdIds: string[]; members: number; present: number | null }>;
  }>;
  services: Array<{ id: string; serviceType: string; title: string | null; present: number; visitors: number }>;
  bacentas: Array<{ id: string; name: string; pastorId: string | null; present: number | null }>;
}
