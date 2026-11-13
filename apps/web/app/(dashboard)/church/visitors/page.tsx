'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer, QrCode } from 'lucide-react';
import type { GuestDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Pager } from '@/components/ui/pager';
import { ChurchTabs } from '@/components/church/church-ui';
import { FollowUpButton } from '@/components/church/follow-up';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { canAddMembers, formatDay, useCursorList, whatsappLink } from '@/lib/membership';

export default function VisitorsPage() {
  const me = useMe();
  const ok = !!me.data && canAddMembers(me.data);
  const qr = useQuery({ queryKey: ['visitor-cards', 'qr'], queryFn: () => api<{ url: string; qrDataUrl: string }>('/visitor-cards/qr'), enabled: ok, staleTime: Infinity });
  const list = useCursorList<GuestDto>(['visitor-cards'], '/visitor-cards', {}, ok);
  if (me.isLoading) return <PageLoader />;
  if (!ok) return <EmptyState title="Visitor cards are for pastors, shepherds and Super Admins" />;

  const print = () => {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w || !qr.data) return;
    w.document.write(
      `<title>Welcome card</title><body style="font-family:system-ui;text-align:center;padding:40px"><h1>First time here?</h1><p style="font-size:20px">Scan to fill in a welcome card</p><img src="${qr.data.qrDataUrl}" style="width:70%"><p>${qr.data.url}</p></body>`,
    );
    w.document.close();
    w.print();
  };

  return (
    <>
      <PageHeader title="Church" subtitle="New people fill in a welcome card by scanning the QR code at church." />
      <ChurchTabs />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[18rem_1fr]">
        <Card className="space-y-3 self-start p-4 text-center">
          <h2 className="flex items-center justify-center gap-2 font-semibold">
            <QrCode className="h-4 w-4" /> Welcome card
          </h2>
          {qr.data ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.data.qrDataUrl} alt="QR code for the welcome card" className="mx-auto w-56 rounded-lg bg-white p-2" />
          ) : (
            <PageLoader />
          )}
          {qr.data && (
            <a href={qr.data.url} target="_blank" rel="noopener noreferrer" className="block break-all text-xs text-brand hover:underline">
              {qr.data.url}
            </a>
          )}
          <Button variant="outline" className="w-full" disabled={!qr.data} onClick={print}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <p className="text-xs text-muted">Show it on the screen or print it for the ushers. People who tick “I’d like to become a member” also appear under New people on the Attendance page.</p>
        </Card>
        <Card className="min-w-0 p-4">
          <h2 className="mb-3 font-semibold">Cards filled in{list.total !== undefined ? ` (${list.total})` : ''}</h2>
          {list.isLoading ? (
            <PageLoader />
          ) : list.error ? (
            <p className="text-sm text-danger">{errorMessage(list.error)}</p>
          ) : !list.items.length ? (
            <p className="text-sm text-muted">No cards yet.</p>
          ) : (
            <>
              <Table>
                <THead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Details</Th>
                    <Th>When</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {list.items.map((g) => (
                    <Tr key={g.id}>
                      <Td className="font-medium">
                        {g.fullName}
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {g.intent === 'JOINING' && <Badge tone="brand">Wants to join</Badge>}
                          {g.convertedMember && <Badge tone="success">Member now</Badge>}
                        </div>
                      </Td>
                      <Td>
                        {g.phone ? (
                          <a className="text-brand hover:underline" href={whatsappLink(g.phone)} target="_blank" rel="noopener noreferrer">
                            {g.phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td className="max-w-xs text-xs">
                        {[g.location, g.howHeard].filter(Boolean).join(' · ')}
                        {g.prayerRequest && <p className="mt-1 italic">“{g.prayerRequest}”</p>}
                      </Td>
                      <Td className="whitespace-nowrap">{g.createdAt ? formatDay(g.createdAt.slice(0, 10)) : ''}</Td>
                      <Td>{!g.convertedMember && <FollowUpButton guestId={g.id} name={g.fullName ?? 'this visitor'} defaultReason="Visited for the first time: welcome call" />}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <Pager list={list} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
