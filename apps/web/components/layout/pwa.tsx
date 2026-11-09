'use client';

import { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { platform } from '@/lib/platform';

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

// Captured as early as possible: Chrome fires it once, possibly before the banner mounts.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event('wcc:installable'));
  });
  window.addEventListener('appinstalled', () => (deferredPrompt = null));
}

/** Open the install guide from anywhere (e.g. the account menu). */
export function openInstall(): void {
  window.dispatchEvent(new Event('wcc:install'));
}

function ShareIcon() {
  // The iOS Share glyph: a square with an arrow pointing up.
  return (
    <svg viewBox="0 0 24 24" className="inline h-5 w-5 align-[-4px] text-[#0a84ff]" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" strokeLinecap="round" />
    </svg>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-3 text-sm">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">{i + 1}</span>
          <span className="pt-0.5">{t}</span>
        </li>
      ))}
    </ol>
  );
}

/** Step-by-step install help: iPhones/iPads have no install prompt, only "Add to Home Screen". */
function InstallGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [p, setP] = useState<ReturnType<typeof platform> | null>(null);
  useEffect(() => setP(platform()), [open]);
  if (!p) return null;
  const copy = () =>
    navigator.clipboard.writeText(window.location.origin).then(
      () => toast.success('Link copied. Paste it into Safari.'),
      () => toast.error('Copy failed. Type the address into Safari instead.'),
    );
  let body: React.ReactNode;
  if (p.standalone) body = <p className="text-sm">WCC Media is already installed. You are using the installed app.</p>;
  else if (p.ios && (p.inApp || p.iosBrowser === 'other' || p.iosBrowser === 'firefox'))
    body = (
      <div className="space-y-4">
        <p className="text-sm">This browser can’t add apps to the Home Screen. Open WCC Media in Safari instead:</p>
        <Steps items={['Copy the link below.', 'Open Safari and paste it into the address bar.', <>Tap <ShareIcon />, then <b>Add to Home Screen</b>.</>]} />
        <Button onClick={copy}>Copy link</Button>
      </div>
    );
  else if (p.ios && p.iosBrowser === 'chrome')
    body = (
      <Steps
        items={[
          <>Tap <ShareIcon /> in the address bar (top right).</>,
          <>Scroll down and tap <b>Add to Home Screen</b>.</>,
          <>Tap <b>Add</b>. WCC Media appears on your Home Screen.</>,
        ]}
      />
    );
  else if (p.ios)
    body = (
      <Steps
        items={[
          <>Tap <ShareIcon /> at the bottom of Safari (on iPad: top right). If you can’t see it, scroll up a little or tap the address bar.</>,
          <>Scroll down the menu and tap <b>Add to Home Screen</b>. Can’t find it? Tap <b>Edit Actions…</b> at the bottom and add it.</>,
          <>Keep <b>Open as Web App</b> switched on (if shown), then tap <b>Add</b>.</>,
          <>Open WCC Media from your Home Screen and sign in once.</>,
        ]}
      />
    );
  else
    body = (
      <Steps
        items={[
          <>Open the browser menu (<b>⋮</b> in Chrome, or the address bar’s install icon on a computer).</>,
          <>Tap <b>Install app</b> or <b>Add to Home screen</b>.</>,
          <>Confirm with <b>Install</b>.</>,
        ]}
      />
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Install WCC Media" description="Add it to your Home Screen to open it like an app.">
      {body}
    </Dialog>
  );
}

/** "Install app" banner plus the guide; the guide can also be opened from the menu. */
export function InstallPrompt() {
  const [canPrompt, setCanPrompt] = useState(false);
  const [show, setShow] = useState(false);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const p = platform();
    let dismissed = false;
    try {
      dismissed = localStorage.getItem('wcc-install-dismissed') === '1';
    } catch {
      /* private mode */
    }
    const sync = () => setCanPrompt(!!deferredPrompt);
    sync();
    window.addEventListener('wcc:installable', sync);
    const onOpen = () => setGuide(true);
    window.addEventListener('wcc:install', onOpen);
    if (!dismissed && !p.standalone && (p.ios || p.android || deferredPrompt)) setShow(true);
    const onInstallable = () => !dismissed && !p.standalone && setShow(true);
    window.addEventListener('wcc:installable', onInstallable);
    return () => {
      window.removeEventListener('wcc:installable', sync);
      window.removeEventListener('wcc:installable', onInstallable);
      window.removeEventListener('wcc:install', onOpen);
    };
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem('wcc-install-dismissed', '1');
    } catch {
      /* ignore */
    }
  };
  const install = async () => {
    if (deferredPrompt) {
      const e = deferredPrompt;
      await e.prompt();
      const { outcome } = await e.userChoice;
      deferredPrompt = null;
      setCanPrompt(false);
      if (outcome === 'accepted') {
        toast.success('WCC Media is installing');
        dismiss();
      }
    } else setGuide(true); // iPhone/iPad, or the browser hasn't offered a prompt
  };

  return (
    <>
      {show && (
        <div className="mb-4 flex items-center gap-3 rounded-[var(--radius)] border border-border bg-surface p-3 text-sm">
          <Download className="h-5 w-5 shrink-0 text-brand" />
          <p className="min-w-0 flex-1">Install WCC Media on this device for quicker access and uploads.</p>
          <Button size="sm" onClick={install}>
            {canPrompt ? 'Install' : 'How to install'}
          </Button>
          <button onClick={dismiss} className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <InstallGuide open={guide} onOpenChange={setGuide} />
    </>
  );
}

/** Menu action: native prompt when the browser offers one, otherwise the guide. */
export async function installApp(): Promise<void> {
  if (deferredPrompt) {
    const e = deferredPrompt;
    await e.prompt();
    const { outcome } = await e.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') toast.success('WCC Media is installing');
  } else openInstall();
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
