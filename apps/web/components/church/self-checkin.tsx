'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { QrCode, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/misc';
import { QrCard, useOrigin } from '@/components/ui/qr-card';
import { api, errorMessage } from '@/lib/api';

interface Status {
  open: boolean;
  code: string | null;
  until: string | null;
  isToday: boolean;
  counts: { members: number; self: number; family: number; phone: number; companions: number; total: number };
}

/**
 * Ushers open self check-in for today's service: members scan the QR code and check
 * themselves in (and the children/relatives with them). The head-count stays as it is.
 */
export function SelfCheckinCard({ sessionId, label }: { sessionId: string; label: string }) {
  const qc = useQueryClient();
  const origin = useOrigin();
  const key = ['checkin', sessionId];
  const q = useQuery({ queryKey: key, queryFn: () => api<Status>(`/attendance/sessions/${sessionId}/checkin`), refetchInterval: (x) => (x.state.data?.open ? 15_000 : false) });
  const set = useMutation({
    mutationFn: (open: boolean) => api<Status>(`/attendance/sessions/${sessionId}/checkin`, { method: open ? 'POST' : 'DELETE', body: open ? { hours: 6 } : undefined }),
    onSuccess: (s) => (qc.setQueryData(key, s), toast.success(s.open ? 'Check-in is open' : 'Check-in closed')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data;
  if (!s) return null;
  return (
    <Card className="space-y-3 p-4" data-self-checkin>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 font-semibold">
          <ScanLine className="h-4 w-4" /> Self check-in
        </h2>
        {s.open ? (
          <Button size="sm" variant="outline" loading={set.isPending} onClick={() => set.mutate(false)}>
            Close check-in
          </Button>
        ) : (
          <Button size="sm" loading={set.isPending} disabled={!s.isToday} onClick={() => set.mutate(true)}>
            <QrCode className="h-4 w-4" /> Open check-in
          </Button>
        )}
      </div>
      <p className="text-sm">
        <b className="text-2xl tabular-nums">{s.counts.total}</b> <span className="text-muted">checked in</span>
        <span className="block text-xs text-muted">
          {s.counts.members} members ({s.counts.self} by the app, {s.counts.phone} by phone number, {s.counts.family} with family) · {s.counts.companions} people with them
        </span>
      </p>
      {s.open && s.code && origin ? (
        <>
          <QrCard
            url={`${origin}/checkin/${s.code}`}
            title="Check in for today’s service"
            subtitle={label}
            steps={['Open your phone camera and point it here', 'Tap “I’m here”', 'Add your children or anyone with you']}
            filename={`wcc-checkin-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          />
          <p className="text-center text-xs text-muted">Works until {new Date(s.until!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} today. Closing it makes this code stop working.</p>
        </>
      ) : (
        <p className="text-xs text-muted">
          {s.isToday
            ? 'Open it to show a QR code for this service. Members check in with the app (or their phone number); children and members without phones check in with their parent or relative.'
            : 'Check-in can only be opened on the day of the service.'}{' '}
          The head-count below is still what the ushers count.
        </p>
      )}
    </Card>
  );
}
