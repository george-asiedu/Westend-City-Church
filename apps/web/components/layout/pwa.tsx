'use client';

import { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Registers /sw.js and offers a reload when a new version is waiting. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        const offer = (worker: ServiceWorker) =>
          toast('A new version is available', { duration: Infinity, action: { label: 'Update', onClick: () => worker.postMessage('SKIP_WAITING') } });
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
          });
        });
        // Check for updates when the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => undefined));
      })
      .catch(() => undefined);
  }, []);
  return null;
}

/** "Install app" banner (Android/desktop), and a hint for iOS Safari. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('wcc-install-dismissed') === '1';
    } catch {
      /* private mode */
    }
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
    if (dismissed || standalone) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) {
      setIos(true);
      setHidden(false);
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem('wcc-install-dismissed', '1');
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius)] border border-border bg-surface p-3 text-sm">
      <Download className="h-5 w-5 shrink-0 text-brand" />
      <p className="flex-1">{ios ? 'Install WCC Media: tap Share, then “Add to Home Screen”.' : 'Install WCC Media on this device for quicker access and uploads.'}</p>
      {!ios && evt && (
        <Button
          size="sm"
          onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            dismiss();
          }}
        >
          Install
        </Button>
      )}
      <button onClick={dismiss} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-warning px-3 py-1.5 text-sm text-white" role="status">
      <WifiOff className="h-4 w-4" /> You are offline. Uploads pause and resume when you reconnect.
    </div>
  );
}
