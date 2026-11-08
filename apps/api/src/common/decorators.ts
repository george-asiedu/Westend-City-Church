import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@wcc/db';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
/** No session required (login, invite acceptance, public share links, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_CSRF = 'skipCsrf';
/** Skip the double-submit token check (the Origin check still applies). */
export const SkipCsrfToken = () => SetMetadata(SKIP_CSRF, true);

export const ALLOW_PENDING_2FA = 'allowPending2fa';
/** Reachable by an admin who still has to enable 2FA (account/2FA endpoints). */
export const AllowPending2fa = () => SetMetadata(ALLOW_PENDING_2FA, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return req.user;
});

export interface ReqMeta {
  ip: string | null;
  userAgent: string | null;
}
export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): ReqMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] ?? '').slice(0, 400) || null };
});
