import { describe, expect, it } from 'vitest';
import type { Role } from '@wcc/db';
import { PolicyService } from './policy.service';
import type { Grant } from '../common/auth-user';

const p = new PolicyService();
const CAT = 'cat-granted';
const OTHER = 'cat-other';
const ROLES: Role[] = ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD', 'VIEWER'];

function user(role: Role, grant: Partial<Grant> = {}, id = 'me') {
  const grants = new Map<string, Grant>();
  grants.set(CAT, { canView: true, canUpload: false, canManage: false, ...grant });
  return { id, role, grants };
}

// Table-driven: [capability, expected per role in ROLES order]
const upload = { canUpload: true };
const manage = { canUpload: true, canManage: true };

describe('§6.1 matrix', () => {
  const cases: Array<[string, (r: Role) => boolean, boolean[]]> = [
    ['view published', (r) => p.canViewEvent(user(r), { categoryId: CAT, createdById: 'x', status: 'PUBLISHED' }), [true, true, true, true]],
    ['create event in granted cat', (r) => p.canCreateEvent(user(r, upload), CAT), [true, true, true, false]],
    ['create event in other cat', (r) => p.canCreateEvent(user(r, upload), OTHER), [true, false, false, false]],
    ['create event without grant', (r) => p.canCreateEvent(user(r), CAT), [true, false, false, false]],
    ['edit own media', (r) => p.canEditMedia(user(r), { uploadedById: 'me', categoryId: CAT }), [true, true, true, false]],
    ['edit others media w/o manage', (r) => p.canEditMedia(user(r, upload), { uploadedById: 'x', categoryId: CAT }), [true, false, false, false]],
    ['edit others media with manage', (r) => p.canEditMedia(user(r, manage), { uploadedById: 'x', categoryId: CAT }), [true, true, true, false]],
    ['edit own event', (r) => p.canEditEvent(user(r), { categoryId: CAT, createdById: 'me', status: 'PUBLISHED' }), [true, true, true, false]],
    ['move with manage on one side only', (r) => p.canMoveMedia(user(r, manage), CAT, OTHER), [true, false, false, false]],
    ['view trash', (r) => p.canViewTrash(user(r)), [true, true, true, false]],
    ['restore own', (r) => p.canRestore(user(r), 'me'), [true, true, true, false]],
    ['restore others', (r) => p.canRestore(user(r), 'x'), [true, false, false, false]],
    ['purge', (r) => p.canPurge(user(r)), [true, false, false, false]],
    ['invite VIEWER', (r) => p.canInvite(user(r), 'VIEWER'), [true, false, false, false]],
    ['invite SUPER_ADMIN', (r) => p.canInvite(user(r), 'SUPER_ADMIN'), [true, false, false, false]],
    ['manage a PASTOR', (r) => p.canManageUser(user(r), { id: 't', role: 'PASTOR' }), [true, false, false, false]],
    ['manage a SUPER_ADMIN', (r) => p.canManageUser(user(r), { id: 't', role: 'SUPER_ADMIN' }), [true, false, false, false]],
    ['promote to admin', (r) => p.canManageUser(user(r), { id: 't', role: 'PASTOR' }, 'SUPER_ADMIN'), [true, false, false, false]],
    ['manage categories', (r) => p.canManageCategories(user(r)), [true, false, false, false]],
    ['view audit', (r) => p.canViewAudit(user(r)), [true, false, false, false]],
  ];

  for (const [name, fn, expected] of cases) {
    ROLES.forEach((role, i) => {
      it(`${name}: ${role} → ${expected[i]}`, () => expect(fn(role)).toBe(expected[i]));
    });
  }
});

describe('drafts and hidden categories', () => {
  const draft = { categoryId: CAT, createdById: 'x', status: 'DRAFT' as const };
  it('draft hidden from non-owner pastor', () => expect(p.canViewEvent(user('PASTOR'), draft)).toBe(false));
  it('draft visible to creator', () => expect(p.canViewEvent(user('PASTOR', {}, 'x'), draft)).toBe(true));
  it('draft visible to manager', () => expect(p.canViewEvent(user('SHEPHERD', manage), draft)).toBe(true));
  it('canView=false hides a category', () =>
    expect(p.canViewCategory(user('VIEWER', { canView: false }), CAT)).toBe(false));
  it('nobody manages themselves', () => expect(p.canManageUser(user('SUPER_ADMIN'), { id: 'me', role: 'SUPER_ADMIN' })).toBe(false));
});

describe('sharing', () => {
  const ev = { categoryId: CAT, createdById: 'x', status: 'PUBLISHED' as const };
  it('pastors can share', () => expect(p.canShareEvent(user('PASTOR'), ev)).toBe(true));
  it('viewers cannot share', () => expect(p.canShareEvent(user('VIEWER'), ev)).toBe(false));
  it('shepherds share only own/managed', () => {
    expect(p.canShareEvent(user('SHEPHERD'), ev)).toBe(false);
    expect(p.canShareEvent(user('SHEPHERD', manage), ev)).toBe(true);
  });
});

describe('role permissions', () => {
  const withPerm = (role: Role) => ({ ...user(role), rolePermissions: new Set(['MANAGE_CATEGORIES']) });
  it('only Super Admin manages folders by default', () => {
    expect(ROLES.map((r) => p.canManageCategories(user(r)))).toEqual([true, false, false, false]);
  });
  it('a granted role can manage folders', () => {
    expect(ROLES.map((r) => p.canManageCategories(withPerm(r)))).toEqual([true, true, true, true]);
  });
  it('only Super Admin edits role permissions, even with grants', () => {
    expect(ROLES.map((r) => p.canManageRolePermissions(withPerm(r)))).toEqual([true, false, false, false]);
  });
});

describe('membership', () => {
  const perm = (role: Role, ...ps: string[]) => ({ ...user(role), rolePermissions: new Set(ps) });
  const mine = { pastorId: 'me', createdById: 'x' };
  const theirs = { pastorId: 'x', createdById: 'x' };
  it('Super Admin and pastors view; others need a grant', () => {
    expect(ROLES.map((r) => p.canViewMembership(user(r)))).toEqual([true, true, true, false]);
    expect(p.canViewMembership(perm('VIEWER', 'VIEW_MEMBERSHIP'))).toBe(true);
  });
  it('pastors create groups and manage only their own', () => {
    expect(ROLES.map((r) => p.canCreateGroup(user(r)))).toEqual([true, true, false, false]);
    expect(p.canManageGroup(user('PASTOR'), mine)).toBe(true);
    expect(p.canManageGroup(user('PASTOR'), theirs)).toBe(false);
    expect(p.canManageGroup(user('SUPER_ADMIN'), theirs)).toBe(true);
    expect(p.canManageGroup(user('VIEWER'), theirs)).toBe(false);
  });
  it('MANAGE_MEMBERSHIP grant gives full control', () => {
    const u = perm('VIEWER', 'MANAGE_MEMBERSHIP');
    expect(p.canManageGroup(u, theirs) && p.canAssignPastor(u) && p.canRecordSunday(u) && p.canViewMembership(u)).toBe(true);
  });
  it('only admins pick another pastor', () => {
    expect(p.canAssignPastor(user('PASTOR'))).toBe(false);
  });
  it('pastors edit members of their groups or members they added', () => {
    expect(p.canEditMember(user('PASTOR'), { createdById: 'x', groups: [mine] })).toBe(true);
    expect(p.canEditMember(user('PASTOR'), { createdById: 'me', groups: [] })).toBe(true);
    expect(p.canEditMember(user('PASTOR'), { createdById: 'x', groups: [theirs] })).toBe(false);
    expect(p.canEditMember(user('VIEWER', ), { createdById: 'me', groups: [] })).toBe(false);
  });
});

describe('shepherds', () => {
  const sh = user('SHEPHERD');
  const theirs = { pastorId: 'x', createdById: 'x', shepherdIds: ['me'] };
  const other = { pastorId: 'x', createdById: 'x', shepherdIds: ['y'] };
  it('view members and add members, but not create groups', () => {
    expect(p.canViewMembership(sh) && p.canAddMembers(sh)).toBe(true);
    expect(p.canCreateGroup(sh)).toBe(false);
  });
  it('manage only groups they shepherd, never administer them', () => {
    expect(p.canManageGroup(sh, theirs)).toBe(true);
    expect(p.canManageGroup(sh, other)).toBe(false);
    expect(p.canAdministerGroup(sh, theirs)).toBe(false);
  });
  it('edit members of their groups', () => {
    expect(p.canEditMember(sh, { createdById: 'x', groups: [theirs] })).toBe(true);
    expect(p.canEditMember(sh, { createdById: 'x', groups: [other] })).toBe(false);
  });
  it('do not record church-wide services or see church-wide stats', () => {
    expect(p.canRecordSunday(sh) || p.canViewChurchStats(sh) || p.canViewChurchStats(user('PASTOR'))).toBe(false);
  });
  it('can upload media where granted, like pastors', () => {
    expect(p.canUpload(user('SHEPHERD', { canUpload: true }), 'cat-granted')).toBe(true);
    expect(p.canUpload(sh, 'cat-granted')).toBe(false);
  });
  it('only Super Admin sees the leaders list', () => {
    expect(ROLES.map((r) => p.canViewLeaders(user(r)))).toEqual([true, false, false, false]);
  });
});

describe('group hierarchy', () => {
  const pa = user('PASTOR');
  it('who creates what', () => {
    expect(p.canCreateGroupOfType(pa, 'CONSTITUENCY')).toBe(false);
    expect(p.canCreateGroupOfType(user('SUPER_ADMIN'), 'CONSTITUENCY')).toBe(true);
    expect(p.canCreateGroupOfType(pa, 'BASONTA', { pastorId: 'me' })).toBe(true);
    expect(p.canCreateGroupOfType(pa, 'BASONTA', { pastorId: 'x' })).toBe(false);
    expect(p.canCreateGroupOfType(pa, 'BACENTA')).toBe(true);
    expect(p.canCreateGroupOfType(user('SHEPHERD'), 'BACENTA')).toBe(false);
  });
  it('head pastor manages and administers basontas under their constituency', () => {
    const basonta = { pastorId: 'x', createdById: 'x', parentPastorId: 'me' };
    expect(p.canManageGroup(pa, basonta) && p.canAdministerGroup(pa, basonta)).toBe(true);
    expect(p.canManageGroup(pa, { ...basonta, parentPastorId: 'y' })).toBe(false);
  });
});

describe('church-service head-counts', () => {
  it('Super Admin and ushers (service-recording bacenta leaders) only', () => {
    expect(ROLES.map((r) => p.canRecordSunday(user(r)))).toEqual([true, false, false, false]);
    expect(p.canRecordSunday({ ...user('SHEPHERD'), serviceRecorder: true })).toBe(true);
    expect(p.canRecordSunday({ ...user('PASTOR'), serviceRecorder: true })).toBe(true);
  });
});
