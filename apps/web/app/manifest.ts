import type { MetadataRoute } from 'next';

/** PWA manifest: installable on phones from day one (§19 PWA install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'WCC Media — The Life Cathedral',
    short_name: 'WCC Media',
    description: 'Photos and videos from every service and event.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7f9',
    theme_color: '#c8102e',
    categories: ['photo', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Add media', url: '/add', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Search', url: '/search', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
