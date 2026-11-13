'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { platform } from '@/lib/platform';
import { openInstall } from '@/components/layout/pwa';

interface Config {
  publicKey: string | null;
  devices: number;
  notifyReminders: boolean;
  notifyStats: boolean;
  notifyBirthdays: boolean;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The service worker, or null if none is registered (e.g. local development). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
}

type State = 'loading' | 'unsupported' | 'install-first' | 'blocked' | 'off' | 'on';

/** Push notifications for this device: attendance reminders and weekend numbers. */
export function NotificationsCard() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['notifications'], queryFn: () => api<Config>('/notifications') });
  const [state, setState] = useState<State>('loading');

  const refresh = async () => {
    const p = platform();
    if (p.ios && !p.standalone) return setState('install-first');
    if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? 'on' : 'off');
  };
  useEffect(() => {
    void refresh();
  }, []);

  const enable = useMutation({
    mutationFn: async () => {
      const key = cfg.data?.publicKey;
      if (!key) throw new Error('Push notifications aren’t set up on the server yet.');
      const reg = await registration();
      if (!reg) throw new Error('Notifications work in the installed or deployed app (not in local development).');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked. Allow them in your browser or phone settings.' : 'Permission wasn’t given.');
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      await api('/notifications/subscriptions', { method: 'POST', body: sub.toJSON() });
    },
    onSuccess: async () => {
      toast.success('Notifications are on for this device');
      await refresh();
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: async (e) => {
      toast.error(errorMessage(e));
      await refresh();
    },
  });
  const disable = useMutation({
    mutationFn: async () => {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) {
        await api('/notifications/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
    },
    onSuccess: async () => {
      toast.success('Notifications are off for this device');
      await refresh();
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const prefs = useMutation({
    mutationFn: (body: Partial<Config>) => api<Partial<Config>>('/notifications/preferences', { method: 'PATCH', body }),
    onSuccess: (r) => (qc.setQueryData<Config>(['notifications'], (c) => (c ? { ...c, ...r } : c)), toast.success('Saved')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => api('/notifications/test', { method: 'POST' }),
    onSuccess: () => toast.success('Test sent. It should arrive in a few seconds.'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const c = cfg.data;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <h2 className="flex flex-1 items-center gap-2 font-semibold">
          <Bell className="h-4 w-4" /> Notifications
        </h2>
        {state === 'on' && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">On for this device</span>}
      </div>
      <p className="text-sm text-muted">
        Reminders to record attendance (Saturdays 8pm and Sundays 1pm, if your group hasn’t yet), the day’s numbers afterwards, and birthdays in your groups (7am).
      </p>

      {c && !c.publicKey ? (
        <p className="rounded-lg bg-surface-2 p-3 text-sm text-muted">Push notifications aren’t set up on the server yet.</p>
      ) : state === 'install-first' ? (
        <div className="space-y-2 rounded-lg bg-surface-2 p-3 text-sm">
          <p>On iPhone and iPad, notifications only work in the installed app.</p>
          <Button size="sm" variant="outline" onClick={openInstall}>
            How to install
          </Button>
          <p className="text-xs text-muted">Then open WCC Media from your Home Screen and turn notifications on here.</p>
        </div>
      ) : state === 'unsupported' ? (
        <p className="rounded-lg bg-surface-2 p-3 text-sm text-muted">This browser doesn’t support notifications. Try Chrome, Edge, Firefox or Safari, or install the app.</p>
      ) : state === 'blocked' ? (
        <p className="rounded-lg bg-surface-2 p-3 text-sm">
          Notifications are blocked for WCC Media. Allow them in your browser’s site settings (or Settings → Notifications on your phone), then reload this page.
        </p>
      ) : state === 'on' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" loading={test.isPending} onClick={() => test.mutate()}>
            <Send className="h-4 w-4" /> Send a test
          </Button>
          <Button size="sm" variant="ghost" loading={disable.isPending} onClick={() => disable.mutate()}>
            <BellOff className="h-4 w-4" /> Turn off on this device
          </Button>
        </div>
      ) : (
        state === 'off' && (
          <Button loading={enable.isPending} disabled={!c} onClick={() => enable.mutate()}>
            <Bell className="h-4 w-4" /> Turn on notifications
          </Button>
        )
      )}

      {c && (
        <div className="space-y-2 border-t border-border pt-3">
          <Checkbox label="Attendance reminders" checked={c.notifyReminders} disabled={prefs.isPending} onChange={(e) => prefs.mutate({ notifyReminders: e.target.checked })} />
          <Checkbox label="Weekend attendance numbers" checked={c.notifyStats} disabled={prefs.isPending} onChange={(e) => prefs.mutate({ notifyStats: e.target.checked })} />
          <Checkbox label="Birthdays in my groups" checked={c.notifyBirthdays} disabled={prefs.isPending} onChange={(e) => prefs.mutate({ notifyBirthdays: e.target.checked })} />
          <p className="text-xs text-muted">
            These apply to all your devices{c.devices ? ` (${c.devices} with notifications on)` : ''}.
          </p>
        </div>
      )}
    </Card>
  );
}
