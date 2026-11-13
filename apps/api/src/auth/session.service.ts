import { forgetLocalSession } from '../common/guards';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Role } from '@wcc/db';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { randomToken, sha256 } from '../common/crypto';
import type { ReqMeta } from '../common/decorators';

export interface IssuedTokens {
  access: string;
  refresh: string;
  csrf: string;
  refreshExpires: Date;
  sessionId: string;
}

const DAY = 86_400_000;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private sign(userId: string, role: Role, sid: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId, role, sid }, { expiresIn: this.env.JWT_ACCESS_TTL_SEC, algorithm: 'HS256' });
  }

  async create(user: { id: string; role: Role }, meta: ReqMeta): Promise<IssuedTokens> {
    const refresh = randomToken();
    const now = Date.now();
    const absolute = new Date(now + this.env.REFRESH_ABSOLUTE_TTL_DAYS * DAY);
    const expiresAt = new Date(Math.min(now + this.env.REFRESH_TTL_DAYS * DAY, absolute.getTime()));
    const s = await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        refreshHash: sha256(refresh),
        userAgent: meta.userAgent,
        ipAddress: meta.ip,
        expiresAt,
        absoluteExpiresAt: absolute,
      },
    });
    return { access: await this.sign(user.id, user.role, s.id), refresh, csrf: randomToken(), refreshExpires: expiresAt, sessionId: s.id };
  }

  /**
   * Rotation with reuse detection (§7.3). Returns `race` when a token was
   * rotated seconds ago (two tabs refreshing at once) — that is not an attack.
   */
  async rotate(
    refreshToken: string,
    meta: ReqMeta,
  ): Promise<{ ok: true; tokens: IssuedTokens; userId: string } | { ok: false; reason: 'invalid' | 'expired' | 'reuse' | 'race'; userId?: string }> {
    const s = await this.prisma.session.findUnique({ where: { refreshHash: sha256(refreshToken) }, include: { user: true } });
    if (!s) return { ok: false, reason: 'invalid' };
    if (s.revokedAt) {
      if (s.revokedReason === 'ROTATED') {
        if (Date.now() - s.revokedAt.getTime() < 20_000) return { ok: false, reason: 'race' };
        await this.revokeFamily(s.familyId, 'REUSE_DETECTED');
        return { ok: false, reason: 'reuse', userId: s.userId };
      }
      return { ok: false, reason: 'invalid' };
    }
    if (s.expiresAt < new Date() || s.absoluteExpiresAt < new Date() || s.user.status !== 'ACTIVE')
      return { ok: false, reason: 'expired' };

    const refresh = randomToken();
    const expiresAt = new Date(Math.min(Date.now() + this.env.REFRESH_TTL_DAYS * DAY, s.absoluteExpiresAt.getTime()));
    const next = await this.prisma.$transaction(async (tx) => {
      // Conditional update: only one concurrent refresh can win.
      const res = await tx.session.updateMany({
        where: { id: s.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
      });
      if (res.count !== 1) return null;
      return tx.session.create({
        data: {
          userId: s.userId,
          familyId: s.familyId,
          refreshHash: sha256(refresh),
          userAgent: meta.userAgent,
          ipAddress: meta.ip,
          expiresAt,
          absoluteExpiresAt: s.absoluteExpiresAt,
          createdAt: s.createdAt,
        },
      });
    });
    if (!next) return { ok: false, reason: 'race' };
    await this.markRevoked([s.id]);
    return {
      ok: true,
      userId: s.userId,
      tokens: {
        access: await this.sign(s.userId, s.user.role, next.id),
        refresh,
        csrf: randomToken(),
        refreshExpires: expiresAt,
        sessionId: next.id,
      },
    };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    await this.markRevoked([sessionId]);
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({ where: { familyId }, select: { id: true } });
    await this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    await this.markRevoked(sessions.map((x) => x.id));
  }

  /** All of a user's sessions, optionally keeping one (the caller's). */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, id: exceptSessionId ? { not: exceptSessionId } : undefined },
      select: { id: true },
    });
    if (!sessions.length) return 0;
    await this.prisma.session.updateMany({
      where: { id: { in: sessions.map((x) => x.id) } },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.markRevoked(sessions.map((x) => x.id));
    return sessions.length;
  }

  /** Tells the auth guard (Redis + this process's short cache) that these sessions are over. */
  private async markRevoked(ids: string[]): Promise<void> {
    for (const id of ids) forgetLocalSession(id);
    await Promise.all(ids.map((id) => this.redis.set(`sess:${id}`, '0', 'EX', 60)));
  }
}
