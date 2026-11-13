import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@wcc/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { notFound } from '../common/errors';
import { loadPrincipal } from '../common/principal';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService, private readonly policy: PolicyService, @Inject(ENV) private readonly env: Env) {}

  async build(userId: string): Promise<MeResponse> {
    const loaded = await loadPrincipal(this.prisma, userId);
    if (!loaded) throw notFound('User');
    const { user: u, grants, rolePermissions, serviceRecorder } = loaded;
    const p = { id: u.id, role: u.role, grants, rolePermissions, serviceRecorder };
    const isAdmin = this.policy.isAdmin(p);
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      title: u.title,
      phone: u.phone,
      role: u.role,
      status: u.status,
      totpEnabled: u.totpEnabled,
      memberId: u.memberId,
      mustChangePassword: u.mustChangePassword,
      mustEnable2fa: this.env.REQUIRE_2FA_FOR_ADMINS && isAdmin && !u.totpEnabled,
      grants: u.categoryAccess.map((g) => ({ categoryId: g.categoryId, canView: g.canView, canUpload: g.canUpload, canManage: g.canManage })),
      permissions: {
        isAdmin,
        canUploadAnywhere: this.policy.canUploadAnywhere(p),
        canInvite: this.policy.canInvite(p, 'VIEWER'),
        canManageCategories: this.policy.canManageCategories(p),
        canManageRolePermissions: this.policy.canManageRolePermissions(p),
        canViewMembership: this.policy.canViewMembership(p),
        canManageMembership: this.policy.isMembershipAdmin(p),
        canCreateGroup: this.policy.canCreateGroup(p),
        canRecordSunday: this.policy.canRecordSunday(p),
        canViewChurchStats: this.policy.canViewChurchStats(p),
        canViewAudit: this.policy.canViewAudit(p),
        canPurge: this.policy.canPurge(p),
      },
    };
  }
}
