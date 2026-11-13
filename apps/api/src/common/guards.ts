import { loadPrincipal } from './principal';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import Redis from 'ioredis';
import type { Role } from '@wcc/db';
import { ENV, Env, allowedOrigins } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import type { AuthUser, Grant } from './auth-user';
import { ALLOW_PENDING_2FA, IS_PUBLIC, ROLES_KEY, SKIP_CSRF } from './decorators';
import { safeEqual } from './crypto';
import { AppException, forbidden, unauthorized } from './errors';
import { HttpStatus } from '@nestjs/common';

export const ACCESS_COOKIE = 'wcc_at';
export const REFRESH_COOKIE = 'wcc_rt';
export const CSRF_COOKIE = 'wcc_csrf';

interface AccessClaims {
  sub: string;
  sid: string;
  role: Role;
}

type Req = Request & { user?: AuthUser };

const LOCAL_SESSION_TTL_MS = 10_000;
const localSessions = new Map<string, { ok: boolean; until: number }>();
function remember(sid: string, ok: boolean): boolean {
  if (localSessions.size > 5000) localSessions.clear(); // bounded memory
  localSessions.set(sid, { ok, until: Date.now() + LOCAL_SESSION_TTL_MS });
  return ok;
}
/** Revoking sessions: forget them here at once (other API instances follow within 10 s). */
export function forgetLocalSession(sid?: string): void {
  if (sid) localSessions.delete(sid);
  else localSessions.clear();
}

/**
 * Global guard order: Csrf → JwtAuth → Roles. Registered in AppModule.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;

    // Origin must be ours on every mutation (§7.4). Browsers always send it on cross-site POSTs.
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins(this.env).includes(origin)) throw forbidden('Bad origin');

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]);
    if (skip) return true;

    const header = req.headers['x-csrf-token'];
    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'CSRF_FAILED', 'Your session needs a quick refresh. Please reload the page and try again.');
    }
    return true;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Req>();
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    if (!token) throw unauthorized();

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('TOKEN_EXPIRED', 'Session expired');
    }

    if (!(await this.sessionActive(claims.sid))) throw unauthorized('SESSION_REVOKED', 'Session ended');

    const loaded = await loadPrincipal(this.prisma, claims.sub);
    const user = loaded?.user;
    if (!loaded || !user || user.status !== 'ACTIVE') throw unauthorized('ACCOUNT_INACTIVE', 'Account is not active');

    req.user = {
      id: user.id,
      sid: claims.sid,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      totpEnabled: user.totpEnabled,
      grants: loaded.grants,
      rolePermissions: loaded.rolePermissions,
      serviceRecorder: loaded.serviceRecorder,
    };

    // Admins must enable 2FA before using anything but their account page (§7.1).
    const isAdmin = user.role === 'SUPER_ADMIN';
    if (this.env.REQUIRE_2FA_FOR_ADMINS && isAdmin && !user.totpEnabled) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_2FA, [ctx.getHandler(), ctx.getClass()]);
      if (!allowed) throw new AppException(HttpStatus.FORBIDDEN, 'TOTP_SETUP_REQUIRED', 'Enable two-factor authentication first');
    }
    return true;
  }

  /** Redis-cached (60 s) so revocation takes effect within a minute (§7.3). */
  private async sessionActive(sid: string): Promise<boolean> {
    // A short in-process cache in front of Redis: saves a network round trip on most requests.
    const local = localSessions.get(sid);
    if (local && local.until > Date.now()) return local.ok;
    const key = `sess:${sid}`;
    const cached = await this.redis.get(key);
    if (cached !== null) return remember(sid, cached === '1');
    const s = await this.prisma.session.findUnique({ where: { id: sid }, select: { revokedAt: true, expiresAt: true } });
    const ok = !!s && !s.revokedAt && s.expiresAt > new Date();
    await this.redis.set(key, ok ? '1' : '0', 'EX', 60);
    return remember(sid, ok);
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<Req>().user;
    if (!user || !roles.includes(user.role)) throw forbidden();
    return true;
  }
}

export { isServiceRecorder } from './principal';
