import { Injectable } from '@nestjs/common';
import type { EventStatus, Role } from '@wcc/db';
import type { AuthUser } from '../common/auth-user';

export interface EventLike {
  categoryId: string;
  createdById: string;
  status: EventStatus;
}
export interface MediaLike {
  uploadedById: string;
  categoryId: string; // the owning event's category
  deletedById?: string | null;
}

type Principal = Pick<AuthUser, 'id' | 'role' | 'grants'> & Partial<Pick<AuthUser, 'rolePermissions'>>;

const ADMINS: Role[] = ['SUPER_ADMIN', 'MEDIA_ADMIN'];
const CONTRIBUTORS: Role[] = ['MEDIA_TEAM', 'PASTOR', 'SHEPHERD'];

/** A group as policy sees it: who leads it and who shepherds it. */
export interface GroupRef {
  pastorId: string | null;
  createdById: string | null;
  shepherdIds?: string[];
  /** For a basonta: its constituency's head pastor. */
  parentPastorId?: string | null;
}

/**
 * Every authorisation decision lives here (§6.2). Services must call it before
 * any mutation; controllers never decide access inline.
 */
@Injectable()
export class PolicyService {
  isAdmin(u: Principal): boolean {
    return ADMINS.includes(u.role);
  }

  private isContributor(u: Principal): boolean {
    return CONTRIBUTORS.includes(u.role);
  }

  canViewCategory(u: Principal, categoryId: string): boolean {
    if (this.isAdmin(u)) return true;
    return u.grants.get(categoryId)?.canView ?? true; // all ACTIVE users view by default
  }

  canUpload(u: Principal, categoryId: string): boolean {
    if (this.isAdmin(u)) return true;
    return this.isContributor(u) && !!u.grants.get(categoryId)?.canUpload;
  }

  canManageCategoryContent(u: Principal, categoryId: string): boolean {
    if (this.isAdmin(u)) return true;
    return this.isContributor(u) && !!u.grants.get(categoryId)?.canManage;
  }

  canUploadAnywhere(u: Principal): boolean {
    return this.isAdmin(u) || (this.isContributor(u) && [...u.grants.values()].some((g) => g.canUpload));
  }

  canCreateEvent(u: Principal, categoryId: string): boolean {
    return this.canUpload(u, categoryId);
  }

  canViewEvent(u: Principal, e: EventLike): boolean {
    if (!this.canViewCategory(u, e.categoryId)) return false;
    if (e.status === 'PUBLISHED') return true;
    return this.isAdmin(u) || e.createdById === u.id || this.canManageCategoryContent(u, e.categoryId);
  }

  canEditEvent(u: Principal, e: EventLike): boolean {
    if (this.isAdmin(u)) return true;
    if (!this.isContributor(u)) return false;
    return e.createdById === u.id || this.canManageCategoryContent(u, e.categoryId);
  }

  canDeleteEvent(u: Principal, e: EventLike): boolean {
    return this.canEditEvent(u, e);
  }

  canUploadToEvent(u: Principal, e: EventLike): boolean {
    return this.canUpload(u, e.categoryId) && this.canViewEvent(u, e);
  }

  canEditMedia(u: Principal, m: MediaLike): boolean {
    if (this.isAdmin(u)) return true;
    if (!this.isContributor(u)) return false;
    return m.uploadedById === u.id || this.canManageCategoryContent(u, m.categoryId);
  }

  canDeleteMedia(u: Principal, m: MediaLike): boolean {
    return this.canEditMedia(u, m);
  }

  canMoveMedia(u: Principal, fromCategoryId: string, toCategoryId: string): boolean {
    return this.canManageCategoryContent(u, fromCategoryId) && this.canManageCategoryContent(u, toCategoryId);
  }

  /** Trash: admins see everything; contributors their own items. */
  canRestore(u: Principal, ownerId: string): boolean {
    if (this.isAdmin(u)) return true;
    return this.isContributor(u) && ownerId === u.id;
  }

  canViewTrash(u: Principal): boolean {
    return this.isAdmin(u) || this.isContributor(u);
  }

  canPurge(u: Principal): boolean {
    return this.isAdmin(u);
  }

  canReprocess(u: Principal): boolean {
    return this.isAdmin(u);
  }

  canInvite(u: Principal, role: Role): boolean {
    if (u.role === 'SUPER_ADMIN') return true;
    if (u.role === 'MEDIA_ADMIN') return !ADMINS.includes(role);
    return false;
  }

  /** Change role/status/grants of `target` (optionally to `newRole`). Nobody edits themselves here. */
  canManageUser(u: Principal, target: { id: string; role: Role }, newRole?: Role): boolean {
    if (target.id === u.id) return false;
    if (u.role === 'SUPER_ADMIN') return true;
    if (u.role === 'MEDIA_ADMIN') return !ADMINS.includes(target.role) && (!newRole || !ADMINS.includes(newRole));
    return false;
  }

  canListUsers(u: Principal): boolean {
    return this.isAdmin(u);
  }

  /** Add, edit and delete folders: Super Admin, or any role a Super Admin granted it to. */
  canManageCategories(u: Principal): boolean {
    return u.role === 'SUPER_ADMIN' || !!u.rolePermissions?.has('MANAGE_CATEGORIES');
  }

  // ---------------------------------------------------------- membership & attendance
  // Super Admin, pastors and shepherds by default; other roles only through role permissions.

  /** Full control over every member, group and attendance record. */
  isMembershipAdmin(u: Principal): boolean {
    return u.role === 'SUPER_ADMIN' || !!u.rolePermissions?.has('MANAGE_MEMBERSHIP');
  }

  private isLeader(u: Principal): boolean {
    return u.role === 'PASTOR' || u.role === 'SHEPHERD';
  }

  canViewMembership(u: Principal): boolean {
    return this.isMembershipAdmin(u) || this.isLeader(u) || !!u.rolePermissions?.has('VIEW_MEMBERSHIP');
  }

  /** Church-wide charts and reports. Pastors and shepherds see stats for their own groups. */
  canViewChurchStats(u: Principal): boolean {
    return this.isMembershipAdmin(u) || !!u.rolePermissions?.has('VIEW_MEMBERSHIP');
  }

  /** Pastors create their own groups (and lead them); admins create any. */
  canCreateGroup(u: Principal): boolean {
    return this.isMembershipAdmin(u) || u.role === 'PASTOR';
  }

  canAddMembers(u: Principal): boolean {
    return this.isMembershipAdmin(u) || this.isLeader(u);
  }

  /** The group's pastor, whoever created it, or (for a basonta) its constituency's head pastor. */
  private leadsGroup(u: Principal, g: GroupRef): boolean {
    return u.role === 'PASTOR' && (g.pastorId === u.id || g.createdById === u.id || (!!g.parentPastorId && g.parentPastorId === u.id));
  }

  /**
   * Constituencies: Super Admin. Basontas: the constituency's head pastor or Super Admin.
   * Bacentas (ministries): any pastor (who then leads it) or Super Admin.
   */
  canCreateGroupOfType(u: Principal, type: 'CONSTITUENCY' | 'BASONTA' | 'BACENTA', parent?: { pastorId: string | null } | null): boolean {
    if (this.isMembershipAdmin(u)) return true;
    if (u.role !== 'PASTOR') return false;
    if (type === 'BACENTA') return true;
    if (type === 'BASONTA') return !!parent && parent.pastorId === u.id;
    return false;
  }

  /** Take attendance and manage members: the pastor, its shepherds, admins. */
  canManageGroup(u: Principal, g: GroupRef): boolean {
    return this.isMembershipAdmin(u) || this.leadsGroup(u, g) || (u.role === 'SHEPHERD' && !!g.shepherdIds?.includes(u.id));
  }

  /** Edit details, delete, assign shepherds: the pastor or admins (not shepherds). */
  canAdministerGroup(u: Principal, g: GroupRef): boolean {
    return this.isMembershipAdmin(u) || this.leadsGroup(u, g);
  }

  /** Choose any user as a group's pastor (pastors can only lead their own). */
  canAssignPastor(u: Principal): boolean {
    return this.isMembershipAdmin(u);
  }

  /** Church-wide services (Sunday, all-night, camps…). */
  canRecordSunday(u: Principal): boolean {
    return this.isMembershipAdmin(u) || u.role === 'PASTOR';
  }

  /** Leaders edit members of groups they manage, or members they added. */
  canEditMember(u: Principal, m: { createdById: string | null; groups: GroupRef[] }): boolean {
    if (this.isMembershipAdmin(u)) return true;
    if (!this.isLeader(u)) return false;
    return m.createdById === u.id || m.groups.some((g) => this.canManageGroup(u, g));
  }

  /** See the list of pastors and shepherds. */
  canViewLeaders(u: Principal): boolean {
    return this.isMembershipAdmin(u);
  }

  canDeleteUser(u: Principal): boolean {
    return u.role === 'SUPER_ADMIN';
  }

  canManageRolePermissions(u: Principal): boolean {
    return u.role === 'SUPER_ADMIN';
  }

  canViewAudit(u: Principal): boolean {
    return this.isAdmin(u);
  }

  /**
   * Share links send media outside the system.
   * DECISION: admins, pastors (who send family photos), the event creator and
   * category managers may share; VIEWER and other MEDIA_TEAM members may not.
   */
  canShareEvent(u: Principal, e: EventLike): boolean {
    if (!this.canViewEvent(u, e)) return false;
    if (this.isAdmin(u) || u.role === 'PASTOR') return true;
    return u.role === 'MEDIA_TEAM' && (e.createdById === u.id || this.canManageCategoryContent(u, e.categoryId));
  }

  canManageShareLink(u: Principal, link: { createdById: string }): boolean {
    return this.isAdmin(u) || link.createdById === u.id;
  }

  canSetPublicHighlight(u: Principal): boolean {
    return this.isAdmin(u);
  }

  canViewStorageStats(u: Principal): boolean {
    return this.isAdmin(u);
  }
}
