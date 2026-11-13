'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Card, PageHeader, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useCursorList } from '@/lib/membership';
import { Pager } from '@/components/ui/pager';
import { formatDateTime } from '@/lib/utils';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { fullName: string; email: string } | null;
}

/** Human-readable sentence for an audit entry (§11.3.9). */
function describe(r: AuditRow): string {
  const m = r.metadata ?? {};
  const s = (k: string) => (m[k] === undefined || m[k] === null ? '' : String(m[k]));
  const map: Record<string, string> = {
    LOGIN: 'signed in',
    LOGOUT: 'signed out',
    LOGIN_FAILED: 'failed to sign in',
    LOGIN_TOTP_FAILED: 'entered a wrong 2FA code',
    ACCOUNT_LOCKED: 'was locked out after repeated failures',
    REFRESH_REUSE_DETECTED: 'had a stolen session token blocked',
    PASSWORD_CHANGED: 'changed their password',
    PASSWORD_RESET: 'reset their password',
    TOTP_ENABLED: 'turned on 2FA',
    TOTP_DISABLED: 'turned off 2FA',
    USER_INVITED: `invited ${s('email')} as ${s('role')}`,
    INVITATION_ACCEPTED: 'accepted an invitation',
    USER_UPDATED: 'updated a user',
    USER_SUSPENDED: 'suspended a user',
    USER_ACCESS_CHANGED: 'changed folder access for a user',
    EVENT_CREATED: `created event “${s('title')}”`,
    EVENT_UPDATED: 'edited an event',
    EVENT_DELETED: `deleted event “${s('title')}” (${s('mediaCount')} items)`,
    EVENT_RESTORED: 'restored an event',
    UPLOAD_STARTED: `started uploading ${s('files')} files`,
    MEDIA_DOWNLOADED: `downloaded ${s('filename')}`,
    MEDIA_REJECTED: `upload rejected: ${s('filename')} (${s('reason')})`,
    MEDIA_PURGED: `permanently deleted ${s('filename')}`,
    SHARE_LINK_CREATED: 'created a share link',
    SHARE_LINK_REVOKED: 'turned off a share link',
    SHARE_MEDIA_DOWNLOADED: 'a visitor downloaded a file from a share link',
    EXPORT_REQUESTED: `requested a ZIP of ${s('files')} files`,
  };
  if (map[r.action]) return map[r.action]!;
  if (r.action.startsWith('MEDIA_BULK_')) return `${r.action.slice(11).toLowerCase()} ${s('count')} items`;
  return r.action.toLowerCase().replace(/_/g, ' ');
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const filters = { action: action || undefined, entityType: entityType || undefined, from: from || undefined };
  const audit = useCursorList<AuditRow>(qk.audit(filters), '/audit', filters);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every sign-in, upload, edit, download and deletion." />
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Input placeholder="Action, e.g. MEDIA_DOWNLOADED" value={action} onChange={(e) => setAction(e.target.value.toUpperCase())} />
        <Select value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Entity">
          <option value="">All types</option>
          {['USER', 'SESSION', 'INVITATION', 'EVENT', 'MEDIA', 'CATEGORY', 'SHARE_LINK', 'EXPORT'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      {audit.isLoading ? (
        <PageLoader />
      ) : (
        <Card className="divide-y divide-border text-sm">
          {audit.items.map((r) => (
            <div key={r.id} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-40 shrink-0 text-xs text-muted">{formatDateTime(r.createdAt)}</span>
              <span className="flex-1">
                <span className="font-medium">{r.actor?.fullName ?? 'System'}</span> {describe(r)}
              </span>
              <span className="text-xs text-muted">{r.ipAddress}</span>
            </div>
          ))}
        </Card>
      )}
      <Pager list={audit} />
    </>
  );
}
