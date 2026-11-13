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
import { tenDigitPhone } from '../church/audience.service';

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
    const groups = await this.prisma.churchGroup.findMany({
      where: { isActive: true, type: { in: ['BASONTA', 'BACENTA'] } },
      select: { id: true, name: true, type: true, parent: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return {
      label: l.label,
      role: l.role,
      roleLabel: ROLE_LABELS[l.role],
      needsApproval: l.role !== 'VIEWER',
      basontas: groups.filter((g) => g.type === 'BASONTA').map((g) => ({ id: g.id, name: g.name, constituency: g.parent?.name ?? null })),
      bacentas: groups.filter((g) => g.type === 'BACENTA').map((g) => ({ id: g.id, name: g.name })),
    };
  }

  /**
   * Someone scanned a QR join code and filled in the sign-up form: their account is created
   * right away and linked to their member record (an existing one with the same email or phone,
   * or a new one in the basonta/bacentas they chose; the constituency comes from the basonta).
   * Members can sign in immediately; pastors and shepherds wait for a Super Admin.
   */
  async join(
    code: string,
    dto: { fullName: string; title?: string; email?: string | null; phone: string; password: string; basontaId?: string | null; bacentaIds?: string[] },
    meta: ReqMeta,
  ): Promise<{ status: 'ACTIVE' | 'PENDING_APPROVAL' }> {
    const l = await this.liveJoinLink(code);
    const email = dto.email?.trim().toLowerCase() || null;
    const fullName = dto.fullName.trim();
    const phone = tenDigitPhone(dto.phone);
    if (!phone) throw badRequest('PHONE', 'Enter your 10-digit phone number, e.g. 0241234567');
    if (await this.prisma.user.findUnique({ where: { phone }, select: { id: true } })) throw conflict('USER_EXISTS', 'There’s already an account with this phone number. Sign in instead.');
    if (email && (await this.prisma.user.findUnique({ where: { email }, select: { id: true } }))) throw conflict('USER_EXISTS', 'There’s already an account with this email. Sign in instead.');
    await this.passwords.assertStrong(dto.password, [email ?? '', phone, fullName]);
    const passwordHash = await this.passwords.hash(dto.password);
    const bacentaIds = [...new Set(dto.bacentaIds ?? [])];
    const groups = await this.prisma.churchGroup.findMany({ where: { id: { in: [...(dto.basontaId ? [dto.basontaId] : []), ...bacentaIds] }, isActive: true }, select: { id: true, type: true, parentId: true } });
    const basonta = dto.basontaId ? groups.find((g) => g.id === dto.basontaId && g.type === 'BASONTA') : undefined;
    if (dto.basontaId && !basonta) throw badRequest('BASONTA', 'Choose a basonta from the list');
    if (bacentaIds.some((id) => !groups.some((g) => g.id === id && g.type === 'BACENTA'))) throw badRequest('BACENTA', 'Choose bacentas from the list');
    const status = l.role === 'VIEWER' ? ('ACTIVE' as const) : ('PENDING_APPROVAL' as const);

    const user = await this.prisma.$transaction(async (tx) => {
      const used = await tx.joinLink.updateMany({ where: { id: l.id, revokedAt: null, OR: [{ maxUses: null }, { uses: { lt: l.maxUses ?? 0 } }] }, data: { uses: { increment: 1 } } });
      if (!used.count) throw badRequest('JOIN_LINK_INVALID', 'This QR code has been used up. Ask the church office for a new one.');
      // Their member record: one already in the directory with this email or phone (and no account), or a new one.
      const existing = await tx.member.findFirst({
        where: { account: null, OR: [{ phone }, ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])] },
        select: { id: true, basontaId: true, email: true, phone: true },
      });
      const placement = basonta ? { basontaId: basonta.id, constituencyId: basonta.parentId } : {};
      const member = existing
        ? await tx.member.update({
            where: { id: existing.id },
            data: { ...(existing.basontaId ? {} : placement), email: existing.email ?? email, phone: existing.phone ?? phone },
            select: { id: true },
          })
        : await tx.member.create({ data: { fullName, email, phone, ...placement, createdById: l.createdById }, select: { id: true } });
      if (bacentaIds.length) await tx.memberBacenta.createMany({ data: bacentaIds.map((groupId) => ({ memberId: member.id, groupId })), skipDuplicates: true });
      const u = await tx.user.create({
        data: {
          email,
          fullName,
          title: dto.title?.trim() || null,
          phone,
          role: l.role,
          status,
          passwordHash,
          passwordChangedAt: new Date(),
          memberId: member.id,
          joinedViaId: l.id,
        },
      });
      if (l.categoryIds.length)
        await tx.userCategoryAccess.createMany({
          data: l.categoryIds.map((categoryId) => ({ userId: u.id, categoryId, canView: true, canUpload: l.role !== 'VIEWER', grantedBy: l.createdById })),
        });
      await this.audit.record({ actorId: u.id, action: 'JOINED_WITH_QR', entityType: 'USER', entityId: u.id, metadata: { role: l.role, link: l.label, status, linkedExistingMember: !!existing }, meta }, tx);
      return u;
    });
    if (status === 'PENDING_APPROVAL') {
      const admins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' }, select: { id: true } });
      await this.queue.push({
        userIds: admins.map((a) => a.id),
        kind: 'reminder',
        payload: { title: `${user.fullName} would like to join as a ${ROLE_LABELS[l.role].toLowerCase()}`, body: `They signed up with “${l.label}”. Tap to review.`, url: '/admin/join-links', tag: 'join-approval' },
      });
    }
    return { status };
  }

  /** Pastors and shepherds who signed up with a QR code and are waiting for a Super Admin. */
  async pendingSignups(user: AuthUser) {
    if (!this.policy.canListUsers(user)) throw forbidden();
    const rows = await this.prisma.user.findMany({
      where: { status: 'PENDING_APPROVAL' },
      select: { id: true, fullName: true, title: true, email: true, phone: true, role: true, createdAt: true, joinedVia: { select: { label: true } }, member: { select: { basonta: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, fullName: r.fullName, title: r.title, email: r.email, phone: r.phone, role: r.role, createdAt: r.createdAt.toISOString(), via: r.joinedVia?.label ?? null, basonta: r.member?.basonta?.name ?? null }));
  }

  async decideSignup(user: AuthUser, id: string, approve: boolean, meta: ReqMeta) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true, role: true, email: true, fullName: true } });
    if (!u || u.status !== 'PENDING_APPROVAL') throw notFound('Sign-up');
    if (!this.policy.canInvite(user, u.role)) throw forbidden();
    if (approve) {
      await this.prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.queue.mail({ to: u.email, template: 'account-approved', data: { name: u.fullName.split(' ')[0] ?? '', role: ROLE_LABELS[u.role], link: `${this.env.WEB_ORIGIN}/login` } });
    } else {
      // Their member record stays in the directory; only the login goes.
      await this.prisma.$transaction([this.prisma.userCategoryAccess.deleteMany({ where: { userId: id } }), this.prisma.auditLog.updateMany({ where: { actorId: id }, data: { actorId: null } }), this.prisma.user.delete({ where: { id } })]);
    }
    await this.audit.record({ actorId: user.id, action: approve ? 'SIGNUP_APPROVED' : 'SIGNUP_DECLINED', entityType: 'USER', entityId: approve ? id : null, metadata: { email: u.email, role: u.role }, meta });
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
