import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../common/guards';

export function cookieBase(env: Env): CookieOptions {
  return {
    domain: env.COOKIE_DOMAIN || undefined, // host-only until a custom domain exists
    secure: env.NODE_ENV !== 'development',
  };
}

export const refreshPath = (env: Env) => `/${env.API_PREFIX.replace(/^\/|\/$/g, '')}/auth/refresh`;

export function setAuthCookies(res: Response, env: Env, t: { access: string; refresh: string; csrf: string; refreshExpires: Date }): void {
  const base = cookieBase(env);
  // DECISION: the access cookie outlives its 15-min JWT (it carries the refresh
  // expiry) so the web middleware can see "signed in" on page routes, where the
  // path-scoped refresh cookie is not sent. The API still rejects expired JWTs.
  res.cookie(ACCESS_COOKIE, t.access, { ...base, httpOnly: true, sameSite: 'lax', path: '/', expires: t.refreshExpires });
  res.cookie(REFRESH_COOKIE, t.refresh, { ...base, httpOnly: true, sameSite: 'strict', path: refreshPath(env), expires: t.refreshExpires });
  res.cookie(CSRF_COOKIE, t.csrf, { ...base, httpOnly: false, sameSite: 'strict', path: '/', expires: t.refreshExpires });
}

export function clearAuthCookies(res: Response, env: Env): void {
  const base = cookieBase(env);
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: refreshPath(env) });
  res.clearCookie(CSRF_COOKIE, { ...base, path: '/' });
  for (const n of ['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'])
    res.clearCookie(n, { ...base, secure: true, path: '/' });
}
