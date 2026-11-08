'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatBytes } from '@wcc/shared';
import { Card, PageHeader, PageLoader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';

interface StorageStats {
  totals: { files: number; originalBytes: string; variantBytes: string; processing: number; failed: number };
  trash: { files: number; bytes: string };
  byCategoryYear: Array<{ categoryId: string; name: string; sortOrder: number; year: number; photos: number; videos: number; bytes: string }>;
}

/** Storage usage per folder and year (§19). S3 Standard ≈ $0.023/GB-month; shown as a rough guide. */
export default function StoragePage() {
  const stats = useQuery({ queryKey: qk.storage, queryFn: () => api<StorageStats>('/stats/storage') });
  const byCategory = useMemo(() => {
    const m = new Map<string, { name: string; bytes: number; photos: number; videos: number; years: StorageStats['byCategoryYear'] }>();
    for (const r of stats.data?.byCategoryYear ?? []) {
      const c = m.get(r.categoryId) ?? { name: r.name, bytes: 0, photos: 0, videos: 0, years: [] };
      c.bytes += Number(r.bytes);
      c.photos += r.photos;
      c.videos += r.videos;
      c.years.push(r);
      m.set(r.categoryId, c);
    }
    return [...m.values()].sort((a, b) => b.bytes - a.bytes);
  }, [stats.data]);

  if (stats.isLoading || !stats.data) return <PageLoader />;
  const t = stats.data.totals;
  const total = Number(t.originalBytes) + Number(t.variantBytes) + Number(stats.data.trash.bytes);
  const max = Math.max(1, ...byCategory.map((c) => c.bytes));
  return (
    <>
      <PageHeader title="Storage" subtitle="What is stored, by folder and year." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Total stored', formatBytes(total)],
          ['Files', t.files.toLocaleString()],
          ['In Trash', `${formatBytes(stats.data.trash.bytes)} (${stats.data.trash.files})`],
          ['Est. S3 cost / month', `$${((total / 1024 ** 3) * 0.023).toFixed(2)}`],
        ].map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="text-xs text-muted">{k}</p>
            <p className="mt-1 text-xl font-semibold">{v}</p>
          </Card>
        ))}
      </div>
      {(t.processing > 0 || t.failed > 0) && (
        <p className="mb-4 text-sm text-muted">
          {t.processing} processing · {t.failed} failed
        </p>
      )}
      <div className="space-y-3">
        {byCategory.map((c) => (
          <Card key={c.name} className="p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-muted">
                {formatBytes(c.bytes)} · {c.photos} photos · {c.videos} videos
              </p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(c.bytes / max) * 100}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {c.years.map((y) => (
                <span key={y.year}>
                  {y.year}: {formatBytes(y.bytes)}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
