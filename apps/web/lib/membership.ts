'use client';

import { useQuery } from '@tanstack/react-query';
import type { AttendanceSummaryDto, GroupDto, GroupStatsDto, GuestDto, LeaderDto, MemberDto, PastorDto, SessionRowDto } from '@wcc/shared';
import { api } from './api';

export const mk = {
  groups: (type?: string) => ['groups', type ?? 'all'] as const,
  group: (id: string) => ['group', id] as const,
  pastors: ['groups', 'pastors'] as const,
  shepherdCandidates: ['groups', 'shepherd-candidates'] as const,
  leaders: ['groups', 'leaders'] as const,
  groupStats: (id: string, params: Record<string, unknown>) => ['group', id, 'stats', params] as const,
  session: (id: string) => ['attendance', 'session', id] as const,
  pendingGuests: ['attendance', 'guests', 'pending'] as const,
  members: (params: Record<string, unknown>) => ['members', params] as const,
  member: (id: string) => ['member', id] as const,
  sheet: (params: Record<string, unknown>) => ['attendance', 'sheet', params] as const,
  sessions: (params: Record<string, unknown>) => ['attendance', 'sessions', params] as const,
  summary: (params: Record<string, unknown>) => ['attendance', 'summary', params] as const,
};

export const useGroups = (type?: 'CONSTITUENCY' | 'BASONTA' | 'BACENTA') =>
  useQuery({ queryKey: mk.groups(type), queryFn: () => api<GroupDto[]>('/groups', { query: { type } }), staleTime: 30_000 });

export const usePastors = (enabled = true) => useQuery({ queryKey: mk.pastors, queryFn: () => api<PastorDto[]>('/groups/pastors'), enabled, staleTime: 60_000 });

export type MemberPage = import('@wcc/shared').Page<MemberDto> & { total: number };
export interface MemberDetail extends MemberDto {
  broughtBy: { id: string; fullName: string } | null;
  history: Array<{
    sessionId: string;
    kind: 'CHURCH_SERVICE' | 'GROUP_MEETING';
    serviceType: string;
    title: string | null;
    date: string;
    group: { id: string; name: string } | null;
    broughtCount: number | null;
  }>;
  brought: GuestDto[];
}
export type SessionRow = SessionRowDto;
export type Summary = AttendanceSummaryDto;
export type GroupStats = GroupStatsDto;
export type Leader = LeaderDto;

export const useShepherdCandidates = (enabled = true) =>
  useQuery({ queryKey: mk.shepherdCandidates, queryFn: () => api<PastorDto[]>('/groups/shepherd-candidates'), enabled, staleTime: 60_000 });

/** "Sunday service", "Sunday service · 2nd service", or the group name for meetings. */
export function sessionName(s: { serviceType: string; title: string | null; group?: { name: string } | null }): string {
  const base = s.group ? `${s.group.name} · ${s.serviceType}` : s.serviceType;
  return s.title ? `${base} · ${s.title}` : base;
}

/** YYYY-MM-DD in the viewer's own time zone (not UTC). */
export function localDate(d = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

/** Most recent Sunday on or before today. */
export function lastSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return localDate(d);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/** "Sun 9 Nov 2026" */
export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Downloads rows as a CSV file (Excel-friendly). */
export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Guard against spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Super Admins (or MANAGE_MEMBERSHIP), pastors and shepherds can add members. */
export function canAddMembers(me: { role: string; permissions: { canManageMembership: boolean } }): boolean {
  return me.permissions.canManageMembership || me.role === 'PASTOR' || me.role === 'SHEPHERD';
}

/** Member-form defaults that put a new member into this group. */
export function memberDefaultsFor(g: { id: string; type: 'CONSTITUENCY' | 'BASONTA' | 'BACENTA' } | null | undefined) {
  if (!g) return undefined;
  return g.type === 'CONSTITUENCY' ? { constituencyId: g.id } : g.type === 'BASONTA' ? { basontaId: g.id } : { bacentaIds: [g.id] };
}

/** "Media (Mixing, Live streaming)" */
export function bacentaLabel(b: { name: string; roles: Array<{ name: string }> }): string {
  return b.roles.length ? `${b.name} (${b.roles.map((r) => r.name).join(', ')})` : b.name;
}

// ---------------------------------------------------------------- cursor pagination
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Page } from '@wcc/shared';

/** Lists load 20 at a time; `more()` fetches the next page. */
export function useCursorList<T>(key: readonly unknown[], path: string, query: Record<string, string | number | boolean | undefined | null> = {}, enabled = true) {
  const q = useInfiniteQuery({
    queryKey: [...key, 'pages'],
    queryFn: ({ pageParam }) => api<Page<T> & Record<string, unknown>>(path, { query: { ...query, cursor: pageParam, limit: 20 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...q, items, first: q.data?.pages[0], total: q.data?.pages[0]?.total, more: () => void q.fetchNextPage() };
}

/** Fetches every page (for CSV exports), 200 at a time. */
export async function fetchAll<T>(path: string, query: Record<string, string | number | boolean | undefined | null> = {}): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const p = await api<Page<T>>(path, { query: { ...query, cursor, limit: 200 } });
    out.push(...p.items);
    cursor = p.nextCursor ?? undefined;
  } while (cursor && out.length < 20000);
  return out;
}
