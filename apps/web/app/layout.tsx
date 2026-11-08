import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Providers } from './providers';
import './globals.css';

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'WCC Media — The Life Cathedral';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · WCC Media` },
  description: 'Private media gallery of Westend City Church (The Life Cathedral).',
  applicationName: 'WCC Media',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'WCC Media', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1015' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies a saved light/dark choice before paint. */}
        <script
          nonce={nonce}
          // Browsers blank out nonce attributes after load; React would flag that as a mismatch.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('wcc-theme');if(t==='dark'||t==='light')document.documentElement.classList.add(t)}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
