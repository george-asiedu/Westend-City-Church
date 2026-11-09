import { Inject, Injectable } from '@nestjs/common';
import type { MeResponse } from '@wcc/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import type { Grant } from '../common/auth-user';
import { notFound } from '../common/errors';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService, private readonly policy: PolicyService, @Inject(ENV) private readonly env: Env) {}

  async build(userId: string): Promise<MeResponse> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { categoryAccess: true } });
    if (!u) throw notFound('User');
    const grants = new Map<string, Grant>(u.categoryAccess.map((g) => [g.categoryId, g]));
    const rolePermissions = new Set(
      (await this.prisma.rolePermission.findMany({ where: { role: u.role }, select: { permission: true } })).map((r) => r.permission),
    );
    const p = { id: u.id, role: u.role, grants, rolePermissions };
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
      mustEnable2fa: this.env.REQUIRE_2FA_FOR_ADMINS && isAdmin && !u.totpEnabled,
      grants: u.categoryAccess.map((g) => ({ categoryId: g.categoryId, canView: g.canView, canUpload: g.canUpload, canManage: g.canManage })),
      permissions: {
        isAdmin,
        canUploadAnywhere: this.policy.canUploadAnywhere(p),
        canInvite: this.policy.canInvite(p, 'VIEWER'),
        canManageCategories: this.policy.canManageCategories(p),
        canManageRolePermissions: this.policy.canManageRolePermissions(p),
        canViewAudit: this.policy.canViewAudit(p),
        canPurge: this.policy.canPurge(p),
      },
    };
  }
}
