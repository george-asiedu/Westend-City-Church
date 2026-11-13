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

  /**
   * Member accounts: a leader invites a church member (who has an email address) to the
   * app with the Member role. Accepting links the new login to that member record.
   */
  async inviteMember(user: AuthUser, memberId: string, meta: ReqMeta) {
    if (!this.policy.canAddMembers(user)) throw forbidden('Only leaders can invite members to the app');
    const m = await this.prisma.member.findUnique({ where: { id: memberId }, select: { id: true, fullName: true, email: true, account: { select: { id: true } } } });
    if (!m) throw badRequest('MEMBER', 'Member not found');
    if (m.account) throw conflict('HAS_ACCOUNT', `${m.fullName} already has an account`);
    if (!m.email) throw badRequest('NO_EMAIL', `Add an email address for ${m.fullName} first: invitations are sent by email`);
    if (await this.prisma.user.findUnique({ where: { email: m.email } })) throw conflict('USER_EXISTS', 'A user with that email already exists');
    return this.create(user, { email: m.email, role: 'VIEWER', categoryIds: [], memberId: m.id }, meta, true);
  }

  async create(user: AuthUser, dto: { email: string; role: Role; categoryIds: string[]; memberId?: string }, meta: ReqMeta, memberInvite = false) {
    if (!memberInvite && !this.policy.canInvite(user, dto.role)) throw forbidden('You cannot invite users with that role');
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
          memberId: dto.memberId ?? null,
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
      select: {
        id: true,
        email: true,
        role: true,
        categoryIds: true,
        expiresAt: true,
        createdAt: true,
        needsApproval: true,
        invitedBy: { select: { id: true, fullName: true } },
        joinLink: { select: { id: true, label: true } },
      },
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

  /** A pastor/shepherd who asked through a join link: approve, and the invitation email goes out. */
  async approve(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const inv = await this.loadManageable(user, id);
    if (!inv.needsApproval) throw badRequest('NOT_PENDING', 'This invitation doesn’t need approval');
    await this.prisma.invitation.update({ where: { id }, data: { needsApproval: false } });
    await this.resend(user, id, meta);
    await this.audit.record({ actorId: user.id, action: 'JOIN_REQUEST_APPROVED', entityType: 'INVITATION', entityId: id, meta });
  }

  // ------------------------------------------------------------ QR join links

  private joinDto(l: { id: string; code: string; label: string; role: Role; maxUses: number | null; uses: number; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date; createdBy?: { fullName: string } | null }) {
    return {
      id: l.id,
      code: l.code,
      label: l.label,
      role: l.role,
      maxUses: l.maxUses,
      uses: l.uses,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      active: !l.revokedAt && (!l.expiresAt || l.expiresAt > new Date()) && (l.maxUses === null || l.uses < l.maxUses),
      createdAt: l.createdAt.toISOString(),
      createdBy: l.createdBy?.fullName ?? null,
      url: `${this.env.WEB_ORIGIN}/join/${l.code}`,
    };
  }

  async createJoinLink(user: AuthUser, dto: { label: string; role: Role; categoryIds?: string[]; maxUses?: number | null; expiresInDays?: number | null }, meta: ReqMeta) {
    if (dto.role === 'SUPER_ADMIN') throw badRequest('ROLE', 'Super Admins are invited one at a time from the app');
    if (!this.policy.canInvite(user, dto.role)) throw forbidden('You cannot invite users with that role');
    const categoryIds = [...new Set(dto.categoryIds ?? [])];
    if (categoryIds.length && (await this.prisma.category.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) throw badRequest('BAD_CATEGORY', 'Unknown category');
    const l = await this.prisma.joinLink.create({
      data: {
        code: randomToken().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24),
        label: dto.label.trim(),
        role: dto.role,
        categoryIds,
        maxUses: dto.maxUses ?? null,
        expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : null,
        createdById: user.id,
      },
      include: { createdBy: { select: { fullName: true } } },
    });
    await this.audit.record({ actorId: user.id, action: 'JOIN_LINK_CREATED', entityType: 'INVITATION', entityId: l.id, metadata: { role: l.role, label: l.label }, meta });
    return this.joinDto(l);
  }

  async listJoinLinks(user: AuthUser) {
    if (!this.policy.canListUsers(user)) throw forbidden();
    const rows = await this.prisma.joinLink.findMany({ orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { fullName: true } } }, take: 100 });
    return rows.map((l) => this.joinDto(l));
  }

  async revokeJoinLink(user: AuthUser, id: string, meta: ReqMeta) {
    const l = await this.prisma.joinLink.findUnique({ where: { id } });
    if (!l) throw notFound('Link');
    if (!this.policy.canInvite(user, l.role)) throw forbidden();
    await this.prisma.joinLink.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'JOIN_LINK_REVOKED', entityType: 'INVITATION', entityId: id, meta });
  }

  private async liveJoinLink(code: string) {
    const l = await this.prisma.joinLink.findUnique({ where: { code } });
    const ok = l && !l.revokedAt && (!l.expiresAt || l.expiresAt > new Date()) && (l.maxUses === null || l.uses < l.maxUses);
    if (!ok) throw badRequest('JOIN_LINK_INVALID', 'This QR code has expired. Ask the church office for a new one.');
    return l!;
  }

  async joinInfo(code: string) {
    const l = await this.liveJoinLink(code);
    return { label: l.label, role: l.role, roleLabel: ROLE_LABELS[l.role], needsApproval: l.role !== 'VIEWER' };
  }

  /**
   * Someone scanned a join QR code and gave their email. We email them the usual invitation
   * link (which proves the address is theirs). Pastor/shepherd requests wait for a Super Admin.
   * The reply is the same whether or not the email already has an account.
   */
  async requestJoin(code: string, dto: { email: string; fullName?: string }, meta: ReqMeta) {
    const l = await this.liveJoinLink(code);
    const email = dto.email.trim().toLowerCase();
    const needsApproval = l.role !== 'VIEWER';
    const result = { needsApproval };
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) return result;
    // Asking again re-sends instead of piling up invitations.
    const pending = await this.prisma.invitation.findFirst({ where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (pending) {
      // Re-send the existing invitation (at most once a minute) instead of making another.
      if (!pending.needsApproval && pending.expiresAt.getTime() < Date.now() + TTL_MS - 60_000) {
        const token = randomToken();
        await this.prisma.invitation.update({ where: { id: pending.id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) } });
        await this.send(email, pending.role, token, 'Westend City Church');
      }
      return { needsApproval: pending.needsApproval };
    }
    const member = await this.prisma.member.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, account: null }, select: { id: true } });
    const token = randomToken();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const used = await tx.joinLink.updateMany({ where: { id: l.id, OR: [{ maxUses: null }, { uses: { lt: l.maxUses ?? 0 } }] }, data: { uses: { increment: 1 } } });
      if (!used.count) return false;
      await tx.invitation.updateMany({ where: { email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const inv = await tx.invitation.create({
        data: {
          email,
          role: l.role,
          categoryIds: l.categoryIds,
          memberId: member?.id ?? null,
          tokenHash: sha256(token),
          invitedById: l.createdById,
          joinLinkId: l.id,
          needsApproval,
          expiresAt: new Date(Date.now() + (needsApproval ? 14 * 86_400_000 : TTL_MS)),
        },
      });
      await this.audit.record({ actorId: null, action: 'JOIN_REQUESTED', entityType: 'INVITATION', entityId: inv.id, metadata: { email, role: l.role, link: l.label, name: dto.fullName ?? null }, meta }, tx);
      return true;
    });
    if (!claimed) throw badRequest('JOIN_LINK_INVALID', 'This QR code has been used up. Ask the church office for a new one.');
    if (!needsApproval) await this.send(email, l.role, token, 'Westend City Church');
    return result;
  }

  private async findValid(token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.needsApproval || inv.expiresAt < new Date())
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
    const contributor = inv.role === 'PASTOR' || inv.role === 'SHEPHERD';
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) throw badRequest('INVITE_INVALID', 'This invitation was already used');
      if (await tx.user.findUnique({ where: { email: inv.email } })) throw conflict('USER_EXISTS', 'Account already exists. Sign in instead.');
      // Link to the member record: the one this invite is for, or a member with the same email.
      const memberId =
        inv.memberId ??
        (await tx.member.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' }, account: null }, select: { id: true } }))?.id ??
        null;
      const linkable = memberId && !(await tx.user.findUnique({ where: { memberId }, select: { id: true } })) ? memberId : null;
      const user = await tx.user.create({
        data: {
          memberId: linkable,
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
