import { DEFAULT_LIMITS } from '@wcc/shared';
import { badRequest } from './errors';

export interface CursorPayload {
  [k: string]: string | number | null;
}

export const encodeCursor = (p: CursorPayload): string => Buffer.from(JSON.stringify(p)).toString('base64url');

export function decodeCursor<T extends CursorPayload>(cursor?: string): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw badRequest('BAD_CURSOR', 'Invalid cursor');
  }
}

export function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMITS.defaultPageSize;
  return Math.max(1, Math.min(DEFAULT_LIMITS.maxPageSize, Math.floor(limit)));
}

/** Date-only helpers: event dates are calendar dates in Africa/Accra (UTC+0). */
export const toDateOnly = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const fromDateOnly = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------- id cursors (lists)
/** Lists show 10 at a time by default (max 200, e.g. for CSV export loops). */
export const pageSize = (limit?: number, def = 10, max = 200): number => Math.max(1, Math.min(max, Math.floor(limit && !Number.isNaN(limit) ? limit : def)));

/**
 * Prisma args for keyset paging by row id: fetch one extra row to know if there's more.
 * The query's orderBy must end with `id` so the order is stable.
 */
export function cursorArgs(cursor: string | undefined, take: number): { take: number; skip?: number; cursor?: { id: string } } {
  const id = cursor ? decodeCursor<{ id: string }>(cursor)?.id : undefined;
  return id ? { take: take + 1, skip: 1, cursor: { id } } : { take: take + 1 };
}

export function pageOf<T extends { id: string }>(rows: T[], take: number): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, take);
  return { items, nextCursor: rows.length > take ? encodeCursor({ id: items[items.length - 1]!.id }) : null };
}
