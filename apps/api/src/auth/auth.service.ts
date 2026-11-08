import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { PasswordService } from './password.service';
import { SessionService, IssuedTokens } from './session.service';
import { TotpService } from './totp.service';
import { MeService } from './me.service';
import { AppException, badRequest, forbidden, unauthorized } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import type { ReqMeta } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import type { LoginDto } from './dto/auth.dto';

const INVALID = () => unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly me: MeService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Fixed-window counter in Redis; returns false once `limit` is exceeded. */
  private async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, windowSec);
    return n <= limit;
  }

  async login(dto: LoginDto, meta: ReqMeta): Promise<{ tokens: IssuedTokens; userId: string }> {
    // 5 attempts / 15 min per email, on top of the per-IP throttle (§13).
    if (!(await this.hit(`login:email:${sha256(dto.email)}`, LOCK_AFTER * 2, LOCK_MINUTES * 60)))
      throw new AppException(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS', 'Too many attempts. Try again later.');

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const ok = await this.passwords.verify(user?.passwordHash, dto.password);

    if (!user) throw INVALID();
    if (user.lockedUntil && user.lockedUntil > new Date())
      throw new AppException(HttpStatus.UNAUTHORIZED, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);

    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= LOCK_AFTER;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined },
      });
      await this.audit.record({ actorId: user.id, action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', entityType: 'USER', entityId: user.id, meta });
      throw INVALID();
    }
    if (user.status !== 'ACTIVE') throw INVALID();

    if (user.totpEnabled) {
      if (!dto.totp) throw new AppException(HttpStatus.UNAUTHORIZED, 'TOTP_REQUIRED', 'Enter the code from your authenticator app');
      const valid = /^\d{6}$/.test(dto.totp)
        ? await this.totp.verify(user.id, user.totpSecretEnc!, dto.totp)
        : await this.useRecoveryCode(user.id, dto.totp);
      if (!valid) {
        await this.audit.record({ actorId: user.id, action: 'LOGIN_TOTP_FAILED', entityType: 'USER', entityId: user.id, meta });
        throw new AppException(HttpStatus.UNAUTHORIZED, 'TOTP_INVALID', 'That code is not valid');
      }
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.sessions.create(user, meta);
    await this.audit.record({ actorId: user.id, action: 'LOGIN', entityType: 'SESSION', entityId: tokens.sessionId, meta });
    return { tokens, userId: user.id };
  }

  private async useRecoveryCode(userId: string, raw: string): Promise<boolean> {
    const code = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    const formatted = `${code.slice(0, 5)}-${code.slice(5)}`;
    const codes = await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });
    for (const c of codes) {
      if (await this.passwords.verify(c.codeHash, formatted)) {
        const res = await this.prisma.recoveryCode.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: new Date() } });
        return res.count === 1;
      }
    }
    return false;
  }

  async refresh(token: string | undefined, meta: ReqMeta) {
    if (!token) throw unauthorized('NO_REFRESH', 'Please sign in');
    const r = await this.sessions.rotate(token, meta);
    if (r.ok) return r;
    if (r.reason === 'reuse')
      await this.audit.record({ actorId: r.userId, action: 'REFRESH_REUSE_DETECTED', entityType: 'SESSION', meta });
    if (r.reason === 'race') throw unauthorized('REFRESH_RACE', 'Refreshed elsewhere; retry');
    throw unauthorized('REFRESH_FAILED', 'Please sign in again');
  }

  async logout(user: AuthUser, meta: ReqMeta): Promise<void> {
    await this.sessions.revoke(user.sid, 'LOGOUT');
    await this.audit.record({ actorId: user.id, action: 'LOGOUT', entityType: 'SESSION', entityId: user.sid, meta });
  }

  async forgotPassword(email: string, meta: ReqMeta): Promise<void> {
    if (!(await this.hit(`forgot:${sha256(email)}`, 3, 3600))) return; // silently: always 204
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    await this.queue.mail({
      to: user.email,
      template: 'password-reset',
      data: { name: user.fullName, link: `${this.env.WEB_ORIGIN}/reset-password/${token}` },
    });
    await this.audit.record({ actorId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'USER', entityId: user.id, meta });
  }

  async resetPassword(token: string, password: string, meta: ReqMeta): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('TOKEN_INVALID', 'This link is invalid or has expired');
    await this.passwords.assertStrong(password, [row.user.email, row.user.fullName]);
    const hash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: hash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      }),
    ]);
    await this.sessions.revokeAllForUser(row.userId, 'PASSWORD_CHANGE');
    await this.audit.record({ actorId: row.userId, action: 'PASSWORD_RESET', entityType: 'USER', entityId: row.userId, meta });
  }

  async changePassword(user: AuthUser, current: string, next: string, meta: ReqMeta): Promise<void> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(u.passwordHash, current))) throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
    await this.passwords.assertStrong(next, [u.email, u.fullName]);
    await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await this.passwords.hash(next), passwordChangedAt: new Date() } });
    await this.sessions.revokeAllForUser(u.id, 'PASSWORD_CHANGE', user.sid);
    await this.audit.record({ actorId: u.id, action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: u.id, meta });
  }

  async setup2fa(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.totpEnabled) throw badRequest('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already on');
    const { secret, encrypted } = this.totp.newSecret();
    await this.prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: encrypted } });
    return { ...(await this.totp.qr(u.email, secret)), secret };
  }

  async enable2fa(user: AuthUser, code: string, meta: ReqMeta): Promise<{ recoveryCodes: string[] }> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.totpEnabled) throw badRequest('TOTP_ALREADY_ENABLED', 'Two-factor authentication is already on');
    if (!u.totpSecretEnc) throw badRequest('TOTP_NOT_SETUP', 'Start the setup first');
    if (!(await this.totp.verify(u.id, u.totpSecretEnc, code))) throw badRequest('TOTP_INVALID', 'That code is not valid');
    const codes = this.totp.recoveryCodes();
    const hashes = await Promise.all(codes.map((c) => this.passwords.hash(c)));
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: u.id } }),
      this.prisma.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: u.id, codeHash })) }),
      this.prisma.user.update({ where: { id: u.id }, data: { totpEnabled: true } }),
    ]);
    await this.audit.record({ actorId: u.id, action: 'TOTP_ENABLED', entityType: 'USER', entityId: u.id, meta });
    await this.queue.mail({ to: u.email, template: '2fa-enabled', data: { name: u.fullName } });
    return { recoveryCodes: codes };
  }

  async disable2fa(user: AuthUser, password: string, code: string, meta: ReqMeta): Promise<void> {
    if (this.env.REQUIRE_2FA_FOR_ADMINS && (user.role === 'SUPER_ADMIN' || user.role === 'MEDIA_ADMIN'))
      throw forbidden('Admins must keep two-factor authentication on');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.totpEnabled || !u.totpSecretEnc) throw badRequest('TOTP_NOT_ENABLED', 'Two-factor authentication is off');
    if (!(await this.passwords.verify(u.passwordHash, password))) throw badRequest('WRONG_PASSWORD', 'Password is incorrect');
    if (!(await this.totp.verify(u.id, u.totpSecretEnc, code))) throw badRequest('TOTP_INVALID', 'That code is not valid');
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: u.id } }),
      this.prisma.user.update({ where: { id: u.id }, data: { totpEnabled: false, totpSecretEnc: null } }),
    ]);
    await this.audit.record({ actorId: u.id, action: 'TOTP_DISABLED', entityType: 'USER', entityId: u.id, meta });
  }

  async listSessions(user: AuthUser) {
    const rows = await this.prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true, userAgent: true, ipAddress: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === user.sid }));
  }

  async revokeSession(user: AuthUser, id: string, meta: ReqMeta): Promise<void> {
    const s = await this.prisma.session.findFirst({ where: { id, userId: user.id } });
    if (!s) return;
    await this.sessions.revoke(id, 'LOGOUT');
    await this.audit.record({ actorId: user.id, action: 'SESSION_REVOKED', entityType: 'SESSION', entityId: id, meta });
  }

  meFor(userId: string) {
    return this.me.build(userId);
  }
}
