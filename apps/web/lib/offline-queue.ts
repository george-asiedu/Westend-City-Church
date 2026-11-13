'use client';

import { api, ApiError } from './api';

/**
 * Attendance saved with no signal waits on this device and is sent when it's back online.
 * Each entry remembers who saved it, so it's only ever sent from that person's session.
 */
export interface QueuedSave {
  id: string;
  userId: string;
  path: string;
  method: 'PUT' | 'POST';
  body: unknown;
  label: string;
  queuedAt: string;
}

const KEY = 'wcc-offline-saves';
export const QUEUE_EVENT = 'wcc-offline-queue';

function read(): QueuedSave[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedSave[];
  } catch {
    return [];
  }
}
function write(items: QueuedSave[]) {
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: nothing we can do */
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

/** The request never reached the server (no signal), as opposed to the server saying no. */
export const isOffline = (e: unknown) => !(e instanceof ApiError) && (e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine));

export function pendingSaves(userId: string): QueuedSave[] {
  return read().filter((x) => x.userId === userId);
}

/** Queue a save. Saves only carry what changed, so they're all kept and sent in order. */
export function queueSave(s: Omit<QueuedSave, 'id' | 'queuedAt'>): void {
  const items = read();
  items.push({ ...s, id: crypto.randomUUID(), queuedAt: new Date().toISOString() });
  write(items);
}

let flushing = false;
/** Sends this user's queued saves in order. Stops at the first network failure. */
export async function flushSaves(userId: string): Promise<{ sent: string[]; failed: Array<{ label: string; message: string }> }> {
  const out = { sent: [] as string[], failed: [] as Array<{ label: string; message: string }> };
  if (flushing || !navigator.onLine) return out;
  flushing = true;
  try {
    for (const s of pendingSaves(userId)) {
      try {
        await api(s.path, { method: s.method, body: s.body });
        out.sent.push(s.label);
      } catch (e) {
        if (isOffline(e)) break;
        out.failed.push({ label: s.label, message: e instanceof Error ? e.message : 'Failed' });
      }
      write(read().filter((x) => x.id !== s.id));
    }
  } finally {
    flushing = false;
  }
  return out;
}
