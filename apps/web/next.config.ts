import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
// Hosted on Vercel (HTTPS); the API and worker run on the VPS.

const config: NextConfig = {
  // Dev gets its own folder so a production build never clobbers a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@wcc/shared'],
  // Media variants are pre-optimised and signed; the Next optimiser is not used (§11.1).
  images: { unoptimized: true },
  // /api/* is proxied to the API by middleware.ts (dev and Vercel alike).
  async headers() {
    const security = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'X-Frame-Options', value: 'DENY' },
      ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
    ];
    return [
      { source: '/:path*', headers: security },
      // The service worker must never be cached stale, and controls the whole origin.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ];
  },
};

export default config;
