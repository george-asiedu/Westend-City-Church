import type { Role } from '@wcc/db';
import type { PrismaService } from '../prisma/prisma.service';
import type { Grant } from './auth-user';

/**
 * Everything the policy layer needs about a user, loaded in one place (used by the auth
 * guard on every request and by /auth/me), with the independent queries run in parallel.
 */

const ROLE_PERMISSION_TTL_MS = 30_000;
const rolePermissionCache = new Map<Role, { at: number; value: Set<string> }>();

/** Extra permissions a Super Admin granted to a role. Rarely changes, so cached briefly in memory. */
export async function rolePermissionsFor(prisma: PrismaService, role: Role): Promise<Set<string>> {
  const hit = rolePermissionCache.get(role);
  if (hit && Date.now() - hit.at < ROLE_PERMISSION_TTL_MS) return hit.value;
  const rows = await prisma.rolePermission.findMany({ where: { role }, select: { permission: true } });
  const value = new Set(rows.map((r) => r.permission));
  rolePermissionCache.set(role, { at: Date.now(), value });
  return value;
}

/** Call after changing role permissions so this instance sees it immediately (others within 30 s). */
export function clearRolePermissionCache(): void {
  rolePermissionCache.clear();
}

/** True if the user is the pastor or a shepherd of an active bacenta that records church services. */
export async function isServiceRecorder(prisma: PrismaService, userId: string): Promise<boolean> {
  const n = await prisma.churchGroup.count({
    where: { type: 'BACENTA', recordsServices: true, isActive: true, OR: [{ pastorId: userId }, { shepherds: { some: { userId } } }] },
  });
  return n > 0;
}

/** The user with category grants, role permissions and service-recorder flag. Null if not found. */
export async function loadPrincipal(prisma: PrismaService, userId: string) {
  const [user, serviceRecorder] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { categoryAccess: true } }),
    isServiceRecorder(prisma, userId),
  ]);
  if (!user) return null;
  const grants = new Map<string, Grant>(user.categoryAccess.map((g) => [g.categoryId, { canView: g.canView, canUpload: g.canUpload, canManage: g.canManage }]));
  const rolePermissions = await rolePermissionsFor(prisma, user.role);
  return { user, grants, rolePermissions, serviceRecorder };
}
