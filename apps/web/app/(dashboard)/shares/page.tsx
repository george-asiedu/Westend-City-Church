'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Download, Link2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

interface ShareRow {
  id: string;
  title: string;
  tokenPrefix: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  hasPassword: boolean;
  allowDownload: boolean;
  expiresAt: string;
  viewCount: number;
  downloadCount: number;
  lastViewedAt: string | null;
  mediaCount: number | null;
  createdAt: string;
  createdBy: { id: string; fullName: string };
  event: { id: string; title: string } | null;
}

export default function SharesPage() {
  const qc = useQueryClient();
  const shares = useQuery({ queryKey: qk.shares(), queryFn: () => api<ShareRow[]>('/shares') });
  return (
    <>
      <PageHeader title="Share links" subtitle="Time-limited links for people outside the church system. Create them from an event or a selection." />
      {shares.isLoading ? (
        <PageLoader />
      ) : !shares.data?.length ? (
        <EmptyState icon={<Link2 className="h-8 w-8" />} title="No share links yet" />
      ) : (
        <div className="space-y-2">
          {shares.data.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {s.title} {s.hasPassword && <Lock className="h-3.5 w-3.5 text-muted" aria-label="Password protected" />}
                </p>
                <p className="text-xs text-muted">
                  {s.event ? (
                    <Link href={`/e/${s.event.id}`} className="hover:underline">
                      Whole event
                    </Link>
                  ) : (
                    `${s.mediaCount} selected items`
                  )}{' '}
                  · by {s.createdBy.fullName} · …/s/{s.tokenPrefix}… · expires {formatDateTime(s.expiresAt)}
                </p>
                <p className="mt-1 flex gap-3 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" /> {s.viewCount} views
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Download className="h-3 w-3" /> {s.allowDownload ? `${s.downloadCount} downloads` : 'downloads off'}
                  </span>
                  {s.lastViewedAt && <span>last viewed {formatDateTime(s.lastViewedAt)}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>{s.status.toLowerCase()}</Badge>
                {s.status === 'ACTIVE' && (
                  <ConfirmButton
                    size="sm"
                    variant="outline"
                    danger
                    title="Turn off this link?"
                    description="Anyone who has it will no longer be able to open it."
                    confirmLabel="Turn off"
                    onConfirm={() =>
                      api(`/shares/${s.id}`, { method: 'DELETE' })
                        .then(() => (toast.success('Link turned off'), qc.invalidateQueries({ queryKey: ['shares'] })))
                        .catch((e) => toast.error(errorMessage(e)))
                    }
                  >
                    Turn off
                  </ConfirmButton>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
