'use client';

import { useQuery } from '@tanstack/react-query';
import type { AttendanceSummaryDto, GroupDto, MemberDto, PastorDto } from '@wcc/shared';
import { api } from './api';

export const mk = {
  groups: (type?: string) => ['groups', type ?? 'all'] as const,
  group: (id: string) => ['group', id] as const,
  pastors: ['groups', 'pastors'] as const,
  members: (params: Record<string, unknown>) => ['members', params] as const,
  member: (id: string) => ['member', id] as const,
  sheet: (params: Record<string, unknown>) => ['attendance', 'sheet', params] as const,
  sessions: (params: Record<string, unknown>) => ['attendance', 'sessions', params] as const,
  summary: (params: Record<string, unknown>) => ['attendance', 'summary', params] as const,
};

export const useGroups = (type?: 'CONSTITUENCY' | 'BASONTA') =>
  useQuery({ queryKey: mk.groups(type), queryFn: () => api<GroupDto[]>('/groups', { query: { type } }), staleTime: 30_000 });

export const usePastors = (enabled = true) => useQuery({ queryKey: mk.pastors, queryFn: () => api<PastorDto[]>('/groups/pastors'), enabled, staleTime: 60_000 });

export interface MemberPage {
  items: MemberDto[];
  total: number;
  page: number;
  pageSize: number;
}
export interface MemberDetail extends MemberDto {
  history: Array<{ sessionId: string; kind: 'SUNDAY_SERVICE' | 'GROUP_MEETING'; date: string; group: { id: string; name: string } | null }>;
}
export interface SessionRow {
  id: string;
  kind: 'SUNDAY_SERVICE' | 'GROUP_MEETING';
  date: string;
  group: { id: string; name: string; type: 'CONSTITUENCY' | 'BASONTA' } | null;
  present: number;
  visitors: number;
  firstTimers: number;
}
export type Summary = AttendanceSummaryDto;

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
