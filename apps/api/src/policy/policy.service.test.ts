import { describe, expect, it } from 'vitest';
import type { Role } from '@wcc/db';
import { PolicyService } from './policy.service';
import type { Grant } from '../common/auth-user';

const p = new PolicyService();
const CAT = 'cat-granted';
const OTHER = 'cat-other';
const ROLES: Role[] = ['SUPER_ADMIN', 'MEDIA_ADMIN', 'MEDIA_TEAM', 'PASTOR', 'VIEWER'];

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
    ['view published', (r) => p.canViewEvent(user(r), { categoryId: CAT, createdById: 'x', status: 'PUBLISHED' }), [true, true, true, true, true]],
    ['create event in granted cat', (r) => p.canCreateEvent(user(r, upload), CAT), [true, true, true, true, false]],
    ['create event in other cat', (r) => p.canCreateEvent(user(r, upload), OTHER), [true, true, false, false, false]],
    ['create event without grant', (r) => p.canCreateEvent(user(r), CAT), [true, true, false, false, false]],
    ['edit own media', (r) => p.canEditMedia(user(r), { uploadedById: 'me', categoryId: CAT }), [true, true, true, true, false]],
    ['edit others media w/o manage', (r) => p.canEditMedia(user(r, upload), { uploadedById: 'x', categoryId: CAT }), [true, true, false, false, false]],
    ['edit others media with manage', (r) => p.canEditMedia(user(r, manage), { uploadedById: 'x', categoryId: CAT }), [true, true, true, true, false]],
    ['edit own event', (r) => p.canEditEvent(user(r), { categoryId: CAT, createdById: 'me', status: 'PUBLISHED' }), [true, true, true, true, false]],
    ['move with manage on one side only', (r) => p.canMoveMedia(user(r, manage), CAT, OTHER), [true, true, false, false, false]],
    ['view trash', (r) => p.canViewTrash(user(r)), [true, true, true, true, false]],
    ['restore own', (r) => p.canRestore(user(r), 'me'), [true, true, true, true, false]],
    ['restore others', (r) => p.canRestore(user(r), 'x'), [true, true, false, false, false]],
    ['purge', (r) => p.canPurge(user(r)), [true, true, false, false, false]],
    ['invite VIEWER', (r) => p.canInvite(user(r), 'VIEWER'), [true, true, false, false, false]],
    ['invite MEDIA_ADMIN', (r) => p.canInvite(user(r), 'MEDIA_ADMIN'), [true, false, false, false, false]],
    ['manage a PASTOR', (r) => p.canManageUser(user(r), { id: 't', role: 'PASTOR' }), [true, true, false, false, false]],
    ['manage a MEDIA_ADMIN', (r) => p.canManageUser(user(r), { id: 't', role: 'MEDIA_ADMIN' }), [true, false, false, false, false]],
    ['promote to admin', (r) => p.canManageUser(user(r), { id: 't', role: 'PASTOR' }, 'MEDIA_ADMIN'), [true, false, false, false, false]],
    ['manage categories', (r) => p.canManageCategories(user(r)), [true, false, false, false, false]],
    ['view audit', (r) => p.canViewAudit(user(r)), [true, true, false, false, false]],
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
  it('draft visible to manager', () => expect(p.canViewEvent(user('MEDIA_TEAM', manage), draft)).toBe(true));
  it('canView=false hides a category', () =>
    expect(p.canViewCategory(user('VIEWER', { canView: false }), CAT)).toBe(false));
  it('nobody manages themselves', () => expect(p.canManageUser(user('SUPER_ADMIN'), { id: 'me', role: 'SUPER_ADMIN' })).toBe(false));
});

describe('sharing', () => {
  const ev = { categoryId: CAT, createdById: 'x', status: 'PUBLISHED' as const };
  it('pastors can share', () => expect(p.canShareEvent(user('PASTOR'), ev)).toBe(true));
  it('viewers cannot share', () => expect(p.canShareEvent(user('VIEWER'), ev)).toBe(false));
  it('media team shares only own/managed', () => {
    expect(p.canShareEvent(user('MEDIA_TEAM'), ev)).toBe(false);
    expect(p.canShareEvent(user('MEDIA_TEAM', manage), ev)).toBe(true);
  });
});

describe('role permissions', () => {
  const withPerm = (role: Role) => ({ ...user(role), rolePermissions: new Set(['MANAGE_CATEGORIES']) });
  it('only Super Admin manages folders by default', () => {
    expect(ROLES.map((r) => p.canManageCategories(user(r)))).toEqual([true, false, false, false, false]);
  });
  it('a granted role can manage folders', () => {
    expect(ROLES.map((r) => p.canManageCategories(withPerm(r)))).toEqual([true, true, true, true, true]);
  });
  it('only Super Admin edits role permissions, even with grants', () => {
    expect(ROLES.map((r) => p.canManageRolePermissions(withPerm(r)))).toEqual([true, false, false, false, false]);
  });
});

describe('membership', () => {
  const perm = (role: Role, ...ps: string[]) => ({ ...user(role), rolePermissions: new Set(ps) });
  const mine = { pastorId: 'me', createdById: 'x' };
  const theirs = { pastorId: 'x', createdById: 'x' };
  it('Super Admin and pastors view; others need a grant', () => {
    expect(ROLES.map((r) => p.canViewMembership(user(r)))).toEqual([true, false, false, true, false]);
    expect(p.canViewMembership(perm('VIEWER', 'VIEW_MEMBERSHIP'))).toBe(true);
  });
  it('pastors create groups and manage only their own', () => {
    expect(ROLES.map((r) => p.canCreateGroup(user(r)))).toEqual([true, false, false, true, false]);
    expect(p.canManageGroup(user('PASTOR'), mine)).toBe(true);
    expect(p.canManageGroup(user('PASTOR'), theirs)).toBe(false);
    expect(p.canManageGroup(user('SUPER_ADMIN'), theirs)).toBe(true);
    expect(p.canManageGroup(user('MEDIA_ADMIN'), theirs)).toBe(false);
  });
  it('MANAGE_MEMBERSHIP grant gives full control', () => {
    const u = perm('MEDIA_TEAM', 'MANAGE_MEMBERSHIP');
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
