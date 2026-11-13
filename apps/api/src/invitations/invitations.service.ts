import { Inject, Injectable } from '@nestjs/common';
import type { Role } from '@wcc/db';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { PasswordService } from '../auth/password.service';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { ROLE_LABELS } from '@wcc/shared';

const TTL_MS = 72 * 3600_000;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly passwords: PasswordService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async send(email: string, role: Role, token: string, inviter: string): Promise<void> {
    await this.queue.mail({
      to: email,
      template: 'invite',
      data: { inviter, role: ROLE_LABELS[role], link: `${this.env.WEB_ORIGIN}/accept-invite/${token}` },
    });
  }

  async create(user: AuthUser, dto: { email: string; role: Role; categoryIds: string[] }, meta: ReqMeta) {
    if (!this.policy.canInvite(user, dto.role)) throw forbidden('You cannot invite users with that role');
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw conflict('USER_EXISTS', 'A user with that email already exists');
    if (dto.categoryIds.length) {
      const n = await this.prisma.category.count({ where: { id: { in: dto.categoryIds } } });
      if (n !== new Set(dto.categoryIds).size) throw badRequest('BAD_CATEGORY', 'Unknown category');
    }
    const token = randomToken();
    const inv = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({ where: { email: dto.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const created = await tx.invitation.create({
        data: {
          email: dto.email,
          role: dto.role,
          categoryIds: [...new Set(dto.categoryIds)],
          tokenHash: sha256(token),
          invitedById: user.id,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
      await this.audit.record(
        { actorId: user.id, action: 'USER_INVITED', entityType: 'INVITATION', entityId: created.id, metadata: { email: dto.email, role: dto.role }, meta },
        tx,
      );
      return created;
    });
    await this.send(dto.email, dto.role, token, user.fullName);
    return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt };
  }

  async listPending(user: AuthUser) {
    if (!this.policy.canListUsers(user)) throw forbidden();
    return this.prisma.invitation.findMany({
      where: { acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, categoryIds: true, expiresAt: true, createdAt: true, invitedBy: { select: { id: true, fullName: true } } },
    });
  }

  private async loadManageable(user: AuthUser, id: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id } });
    if (!inv || inv.acceptedAt || inv.revokedAt) throw notFound('Invitation');
    if (!this.policy.canInvite(user, inv.role)) throw forbidden();
    return inv;
  }

  async revoke(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    await this.loadManageable(user, id);
    await this.prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'INVITATION_REVOKED', entityType: 'INVITATION', entityId: id, meta });
  }

  async resend(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const inv = await this.loadManageable(user, id);
    const token = randomToken();
    await this.prisma.invitation.update({ where: { id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
    await this.send(inv.email, inv.role, token, user.fullName);
    await this.audit.record({ actorId: user.id, action: 'INVITATION_RESENT', entityType: 'INVITATION', entityId: id, meta });
  }

  private async findValid(token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date())
      throw badRequest('INVITE_INVALID', 'This invitation is invalid or has expired. Ask an admin to resend it.');
    return inv;
  }

  async verify(token: string) {
    const inv = await this.findValid(token);
    return { email: inv.email, role: inv.role };
  }

  async accept(dto: { token: string; fullName: string; title?: string; phone?: string; password: string }, meta: ReqMeta): Promise<void> {
    const inv = await this.findValid(dto.token);
    await this.passwords.assertStrong(dto.password, [inv.email, dto.fullName]);
    const passwordHash = await this.passwords.hash(dto.password);
    const contributor = inv.role === 'MEDIA_TEAM' || inv.role === 'PASTOR' || inv.role === 'SHEPHERD';
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw badRequest('INVITE_INVALID', 'This invitation was already used');
      if (await tx.user.findUnique({ where: { email: inv.email } })) throw conflict('USER_EXISTS', 'Account already exists. Sign in instead.');
      const user = await tx.user.create({
        data: {
          email: inv.email,
          fullName: dto.fullName.trim(),
          title: dto.title?.trim() || null,
          phone: dto.phone?.trim() || null,
          role: inv.role,
          status: 'ACTIVE',
          passwordHash,
          passwordChangedAt: new Date(),
        },
      });
      if (inv.categoryIds.length)
        await tx.userCategoryAccess.createMany({
          data: inv.categoryIds.map((categoryId) => ({ userId: user.id, categoryId, canView: true, canUpload: contributor, grantedBy: inv.invitedById })),
        });
      await this.audit.record({ actorId: user.id, action: 'INVITATION_ACCEPTED', entityType: 'USER', entityId: user.id, meta }, tx);
    });
  }
}
