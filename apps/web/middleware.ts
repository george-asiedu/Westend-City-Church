import { NextResponse, type NextRequest } from 'next/server';

// Pages that need no session. Everything else is the private dashboard.
const PUBLIC = [/^\/login/, /^\/accept-invite\//, /^\/forgot-password/, /^\/reset-password\//, /^\/verify-email\//, /^\/s\//, /^\/highlights/, /^\/offline/];

/**
 * The browser only ever talks to this app's origin (Vercel in production,
 * localhost in dev). /api/* is proxied from here to the API on the VPS, so
 * auth cookies stay first-party and CSRF/CSP need no cross-origin exceptions.
 */
function proxyApi(req: NextRequest): NextResponse {
  const upstream = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, upstream);
  const headers = new Headers(req.headers);
  // The real visitor IP for the API's rate limits. nginx trusts it only with the shared key,
  // so nobody can spoof an IP by calling the VPS directly.
  const clientIp = (req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  headers.delete('x-wcc-proxy-key');
  headers.delete('x-wcc-client-ip');
  if (process.env.API_PROXY_SECRET) headers.set('x-wcc-proxy-key', process.env.API_PROXY_SECRET);
  if (clientIp) headers.set('x-wcc-client-ip', clientIp);
  return NextResponse.rewrite(target, { request: { headers } });
}

function csp(nonce: string): string {
  const dev = process.env.NODE_ENV !== 'production';
  // Exact media hosts (S3 bucket host, CloudFront domain) from the environment.
  const media = (process.env.MEDIA_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media}`,
    `media-src 'self' blob: ${media}`,
    `connect-src 'self' ${media}${dev ? ' ws:' : ''}`,
    "font-src 'self' data:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/api/')) return proxyApi(req);

  const isPublic = pathname === '/' ? false : PUBLIC.some((r) => r.test(pathname));
  // Presence check only — the API is the real enforcer (§11.4).
  if (!isPublic && !req.cookies.has('wcc_at')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', policy);
  if (pathname.startsWith('/s/')) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|icons/|sw.js|manifest.webmanifest|favicon.ico|logo.png|icon.png|robots.txt).*)'],
};
