import type { Role } from '@wcc/db';

export interface Grant {
  canView: boolean;
  canUpload: boolean;
  canManage: boolean;
}

/** The authenticated principal, attached to req.user by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  sid: string;
  email: string;
  fullName: string;
  role: Role;
  totpEnabled: boolean;
  /** categoryId → grant; loaded once per request. */
  grants: Map<string, Grant>;
  /** Extra permissions granted to this user's role by a Super Admin. */
  rolePermissions?: Set<string>;
}
