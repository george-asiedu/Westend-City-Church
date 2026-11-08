'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { useEvent } from '@/lib/queries';
import { eventDateRange } from '@/lib/utils';

const Uploader = dynamic(() => import('@/components/upload/uploader').then((m) => m.Uploader), { ssr: false, loading: () => <PageLoader /> });

export default function UploadPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const event = useEvent(eventId);
  const qc = useQueryClient();
  if (event.isLoading) return <PageLoader />;
  const e = event.data;
  if (!e || !e.canUpload) return <EmptyState title="You cannot upload to this event" />;
  return (
    <>
      <PageHeader title={`Upload to ${e.title}`} subtitle={`${e.category.name} · ${eventDateRange(e.eventDate, e.endDate)}`}>
        <Link href={`/e/${e.id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back to gallery
        </Link>
      </PageHeader>
      <Uploader eventId={e.id} onUploaded={() => void qc.invalidateQueries({ queryKey: ['media', e.id] })} />
      <p className="mt-3 text-xs text-muted">
        If the connection drops or the page reloads, reopen this page: unfinished uploads resume where they stopped. Original files keep their camera data (including location); previews in the gallery do not.
      </p>
    </>
  );
}
