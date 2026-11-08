import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MONTH_NAMES, formatEventDate } from '@wcc/shared';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function eventDateRange(start: string, end: string | null): string {
  if (!end || end === start) return formatEventDate(start);
  return `${formatEventDate(start)} – ${formatEventDate(end)}`;
}

export const monthName = (m: number) => MONTH_NAMES[m - 1] ?? '';

/** "8 Nov 2026, 17:05" in Africa/Accra (UTC+0). */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function daysUntil(iso: string | Date | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function formatDuration(sec: number | null): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export const todayIso = () => new Date().toISOString().slice(0, 10); // Accra is UTC+0
