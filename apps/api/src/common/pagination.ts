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
