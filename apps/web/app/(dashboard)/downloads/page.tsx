'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, Package } from 'lucide-react';
import { formatBytes } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { api, API_BASE } from '@/lib/api';
import { qk } from '@/lib/queries';
import { formatDateTime } from '@/lib/utils';

interface ExportRow {
  id: string;
  title: string;
  status: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED';
  fileCount: number;
  sizeBytes: string;
  createdAt: string;
  expiresAt: string;
}

export default function DownloadsPage() {
  const exports = useQuery({
    queryKey: qk.exports,
    queryFn: () => api<ExportRow[]>('/exports'),
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'PENDING' || e.status === 'RUNNING') ? 4000 : false),
  });
  return (
    <>
      <PageHeader title="Downloads" subtitle="ZIP files of events or selections. Each is available for 24 hours." />
      {exports.isLoading ? (
        <PageLoader />
      ) : !exports.data?.length ? (
        <EmptyState icon={<Package className="h-8 w-8" />} title="No downloads yet">
          Use “Download all (ZIP)” on an event, or select items and choose ZIP.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {exports.data.map((e) => (
            <Card key={e.id} className="flex items-center gap-3 p-4">
              <Package className="h-5 w-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.title}</p>
                <p className="text-xs text-muted">
                  {e.fileCount} files{e.status === 'READY' ? ` · ${formatBytes(e.sizeBytes)}` : ''} · requested {formatDateTime(e.createdAt)} · expires {formatDateTime(e.expiresAt)}
                </p>
              </div>
              {e.status === 'READY' ? (
                <a href={`${API_BASE}/exports/${e.id}/download`}>
                  <Button size="sm">
                    <Download className="h-4 w-4" /> Download
                  </Button>
                </a>
              ) : (
                <Badge tone={e.status === 'FAILED' ? 'danger' : 'brand'}>{e.status === 'FAILED' ? 'Failed' : 'Preparing…'}</Badge>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
