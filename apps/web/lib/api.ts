'use client';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

let refreshing: Promise<'ok' | 'race' | 'fail'> | null = null;

/** Single-flight refresh: concurrent 401s share one /auth/refresh call (§11.4). */
function refresh(): Promise<'ok' | 'race' | 'fail'> {
  refreshing ??= fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': readCookie('wcc_csrf') ?? '' },
  })
    .then(async (r) => {
      if (r.ok) return 'ok' as const;
      const body = (await r.json().catch(() => ({}))) as { code?: string };
      return body.code === 'REFRESH_RACE' ? ('race' as const) : ('fail' as const);
    })
    .catch(() => 'fail' as const)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

function toLogin(): void {
  if (typeof window === 'undefined') return;
  const next = window.location.pathname + window.location.search;
  if (!window.location.pathname.startsWith('/login')) window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Public endpoints (share links): never try to refresh or redirect. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/** When the server sends no message (e.g. a proxy error page). */
const fallbackMessage = (status: number) =>
  status >= 500 ? 'Sorry, something went wrong on our side. Please try again in a moment.' : 'Sorry, that didn’t work. Please try again.';

export async function api<T = unknown>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const method = opts.method ?? 'GET';
  const qs = opts.query
    ? '?' +
      new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = readCookie('wcc_csrf') ?? '';

  const res = await fetch(`${API_BASE}${path}${qs === '?' ? '' : qs}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (res.status === 401 && !opts.anonymous && !retried && !path.startsWith('/auth/login')) {
    const body = (await res.clone().json().catch(() => ({}))) as { code?: string };
    if (body.code !== 'TOTP_REQUIRED' && body.code !== 'TOTP_INVALID' && body.code !== 'INVALID_CREDENTIALS') {
      const r = await refresh();
      if (r === 'ok' || r === 'race') return api<T>(path, opts, true);
      toLogin();
    }
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { code?: string; message?: string; details?: unknown }) | null;
  if (!res.ok) {
    const err = new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? fallbackMessage(res.status), data?.details);
    if (res.status === 401 && retried && !opts.anonymous) toLogin();
    if (res.status === 403 && err.code === 'TOTP_SETUP_REQUIRED' && typeof window !== 'undefined' && !window.location.pathname.startsWith('/account'))
      window.location.assign('/account?setup2fa=1');
    throw err;
  }
  return data as T;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Sorry, something went wrong. Please try again.');
