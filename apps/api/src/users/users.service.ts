import { cursorArgs, pageOf, pageSize } from '../common/pagination';
import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PasswordService } from '../auth/password.service';
import { Prisma, Role, UserStatus } from '@wcc/db';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { MeService } from '../auth/me.service';
import { badRequest, forbidden, notFound } from '../common/errors';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  title: true,
  phone: true,
  role: true,
  status: true,
  totpEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  categoryAccess: { select: { categoryId: true, canView: true, canUpload: true, canManage: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly me: MeService,
    private readonly passwords: PasswordService,
  ) {}

  /** 10 at a time, active first then by name. */
  async list(user: AuthUser, q: { role?: Role; status?: UserStatus; q?: string; cursor?: string; limit?: number }) {
    if (!this.policy.canListUsers(user)) throw forbidden();
    const take = pageSize(q.limit);
    const where = {
      role: q.role,
      status: q.status,
      OR: q.q ? [{ email: { contains: q.q, mode: 'insensitive' as const } }, { fullName: { contains: q.q, mode: 'insensitive' as const } }] : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: [{ status: 'asc' }, { fullName: 'asc' }, { id: 'asc' }], select: PUBLIC_FIELDS, ...cursorArgs(q.cursor, take) }),
      this.prisma.user.count({ where }),
    ]);
    return { ...pageOf(rows, take), total };
  }

  async get(user: AuthUser, id: string) {
    if (!this.policy.canListUsers(user) && user.id !== id) throw forbidden();
    const u = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!u) throw notFound('User');
    return u;
  }

  private async loadTarget(user: AuthUser, id: string, newRole?: Role) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('User');
    if (!this.policy.canManageUser(user, target, newRole)) throw forbidden('You cannot manage this user');
    return target;
  }

  async update(user: AuthUser, id: string, dto: { role?: Role; status?: UserStatus; fullName?: string; title?: string; phone?: string }, meta: ReqMeta) {
    const target = await this.loadTarget(user, id, dto.role);
    if (dto.status === 'INVITED') throw badRequest('BAD_STATUS', 'Cannot set status back to INVITED');
    if (target.role === 'SUPER_ADMIN' && (dto.role && dto.role !== 'SUPER_ADMIN' || dto.status === 'SUSPENDED')) {
      const others = await this.prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } } });
      if (others === 0) throw badRequest('LAST_SUPER_ADMIN', 'There must be at least one active Super Admin');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { role: dto.role, status: dto.status, fullName: dto.fullName, title: dto.title, phone: dto.phone },
      select: PUBLIC_FIELDS,
    });
    if ((dto.status && dto.status !== target.status && dto.status === 'SUSPENDED') || (dto.role && dto.role !== target.role)) {
      await this.sessions.revokeAllForUser(id, 'ADMIN');
    }
    await this.audit.record({
      actorId: user.id,
      action: dto.status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_UPDATED',
      entityType: 'USER',
      entityId: id,
      metadata: { before: { role: target.role, status: target.status }, after: dto } as Prisma.InputJsonValue,
      meta,
    });
    return updated;
  }

  async updateMe(user: AuthUser, dto: { fullName?: string; title?: string; phone?: string }, meta: ReqMeta) {
    await this.prisma.user.update({ where: { id: user.id }, data: { fullName: dto.fullName?.trim(), title: dto.title?.trim(), phone: dto.phone?.trim() } });
    await this.audit.record({ actorId: user.id, action: 'PROFILE_UPDATED', entityType: 'USER', entityId: user.id, meta });
    return this.me.build(user.id);
  }

  async setAccess(user: AuthUser, id: string, grants: Array<{ categoryId: string; canView: boolean; canUpload: boolean; canManage: boolean }>, meta: ReqMeta) {
    await this.loadTarget(user, id);
    const ids = [...new Set(grants.map((g) => g.categoryId))];
    if (ids.length !== grants.length) throw badRequest('DUPLICATE_CATEGORY', 'Each category may appear once');
    if (ids.length && (await this.prisma.category.count({ where: { id: { in: ids } } })) !== ids.length)
      throw badRequest('BAD_CATEGORY', 'Unknown category');
    await this.prisma.$transaction(async (tx) => {
      await tx.userCategoryAccess.deleteMany({ where: { userId: id } });
      if (grants.length)
        await tx.userCategoryAccess.createMany({
          data: grants.map((g) => ({ ...g, canView: g.canView || g.canUpload || g.canManage, userId: id, grantedBy: user.id })),
        });
      await this.audit.record({ actorId: user.id, action: 'USER_ACCESS_CHANGED', entityType: 'USER', entityId: id, metadata: { grants }, meta }, tx);
    });
    return this.get(user, id);
  }

  /**
   * Super Admin: gives someone a one-time temporary password (e.g. a member who joined with a
   * phone number and has no email to reset it). They're signed out everywhere and must choose
   * their own password the next time they sign in. Not for other Super Admins.
   */
  async resetPassword(user: AuthUser, id: string, meta: ReqMeta): Promise<{ temporaryPassword: string; fullName: string; phone: string | null }> {
    const target = await this.loadTarget(user, id);
    if (target.role === 'SUPER_ADMIN') throw forbidden('Super Admins reset their own password by email');
    if (target.status === 'PENDING_APPROVAL') throw badRequest('PENDING', 'Approve this account first');
    // No look-alike characters (0/O, 1/l/I), so it's easy to read out or type.
    const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const part = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join('');
    const temporaryPassword = `${part()}-${part()}-${part()}`;
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await this.passwords.hash(temporaryPassword), passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    await this.sessions.revokeAllForUser(id, 'ADMIN');
    await this.prisma.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'PASSWORD_RESET_BY_ADMIN', entityType: 'USER', entityId: id, meta });
    return { temporaryPassword, fullName: target.fullName, phone: target.phone };
  }

  async revokeSessions(user: AuthUser, id: string, meta: ReqMeta) {
    await this.loadTarget(user, id);
    const count = await this.sessions.revokeAllForUser(id, 'ADMIN');
    await this.audit.record({ actorId: user.id, action: 'USER_SESSIONS_REVOKED', entityType: 'USER', entityId: id, metadata: { count }, meta });
    return { revoked: count };
  }

  /**
   * Permanently deletes an account. Their events and uploads are kept and transferred to
   * the admin doing the delete; their share links stop working; audit entries keep the
   * history (actor becomes empty).
   */
  async remove(user: AuthUser, id: string, meta: ReqMeta): Promise<{ transferredEvents: number; transferredMedia: number }> {
    if (!this.policy.canDeleteUser(user)) throw forbidden('Only a Super Admin can delete users');
    if (id === user.id) throw badRequest('CANNOT_DELETE_SELF', 'You cannot delete your own account');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('User');
    if (target.role === 'SUPER_ADMIN') {
      const others = await this.prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE', id: { not: id } } });
      if (others === 0) throw badRequest('LAST_SUPER_ADMIN', 'There must be at least one active Super Admin');
    }
    await this.sessions.revokeAllForUser(id, 'USER_DELETED');
    const result = await this.prisma.$transaction(async (tx) => {
      const ev = await tx.event.updateMany({ where: { createdById: id }, data: { createdById: user.id } });
      const media = await tx.mediaAsset.updateMany({ where: { uploadedById: id }, data: { uploadedById: user.id } });
      await tx.invitation.updateMany({ where: { invitedById: id }, data: { invitedById: user.id } });
      await tx.shareLink.deleteMany({ where: { createdById: id } });
      await tx.user.delete({ where: { id } });
      return { transferredEvents: ev.count, transferredMedia: media.count };
    });
    await this.audit.record({
      actorId: user.id,
      action: 'USER_DELETED',
      entityType: 'USER',
      entityId: id,
      metadata: { email: target.email, fullName: target.fullName, role: target.role, ...result },
      meta,
    });
    return result;
  }
}
