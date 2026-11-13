import { Body, Controller, Get, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, ValidateNested } from 'class-validator';
import { ROLE_PERMISSIONS, type RolePermissionKey } from '@wcc/shared';
import type { Role } from '@wcc/db';
import { CurrentUser, Meta, ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { forbidden } from '../common/errors';

/** Roles a Super Admin can grant extra permissions to (Super Admin already has all). */
const GRANTABLE_ROLES: Role[] = ['MEDIA_ADMIN', 'MEDIA_TEAM', 'PASTOR', 'SHEPHERD', 'VIEWER'];
const PERMISSIONS = Object.values(ROLE_PERMISSIONS);

class RolePermissionItem {
  @IsIn(GRANTABLE_ROLES) role!: Role;
  @IsIn(PERMISSIONS) permission!: RolePermissionKey;
}
class SetRolePermissionsDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RolePermissionItem) grants!: RolePermissionItem[];
}

@Controller('role-permissions')
export class RolePermissionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    if (!this.policy.canManageRolePermissions(user)) throw forbidden();
    const rows = await this.prisma.rolePermission.findMany({ select: { role: true, permission: true } });
    return { roles: GRANTABLE_ROLES, permissions: PERMISSIONS, grants: rows };
  }

  /** Replaces every role grant with the given list. */
  @Put()
  async set(@CurrentUser() user: AuthUser, @Body() dto: SetRolePermissionsDto, @Meta() meta: ReqMeta) {
    if (!this.policy.canManageRolePermissions(user)) throw forbidden();
    const unique = [...new Map(dto.grants.map((g) => [`${g.role}:${g.permission}`, g])).values()];
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({}),
      this.prisma.rolePermission.createMany({ data: unique.map((g) => ({ role: g.role, permission: g.permission })) }),
    ]);
    await this.audit.record({ actorId: user.id, action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'SETTINGS', metadata: { grants: unique.map((g) => `${g.role}:${g.permission}`) }, meta });
    return { roles: GRANTABLE_ROLES, permissions: PERMISSIONS, grants: unique };
  }
}
