'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, MemberFormDialog } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { formatDay, mk, type MemberDetail } from '@/lib/membership';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children || '—'}</dd>
    </div>
  );
}

export default function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const m = useQuery({ queryKey: mk.member(id), queryFn: () => api<MemberDetail>(`/members/${id}`) });
  if (m.isLoading) return <PageLoader />;
  const d = m.data;
  if (!d) return <EmptyState title="Member not found">{m.error ? errorMessage(m.error) : null}</EmptyState>;
  const age = d.dateOfBirth ? Math.floor((Date.now() - Date.parse(d.dateOfBirth)) / (365.25 * 86_400_000)) : null;

  return (
    <>
      <PageHeader
        title={d.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{d.churchRole}</Badge>
            {!d.isActive && <Badge tone="warning">Inactive</Badge>}
            <span>Last seen: {d.lastSeen ? formatDay(d.lastSeen) : 'never'}</span>
          </span>
        }
        actions={
          d.canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )
        }
      >
        <button onClick={() => router.back()} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </PageHeader>
      <ChurchTabs />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {d.phone && (
              <a href={`tel:${d.phone}`}>
                <Button size="sm">
                  <Phone className="h-4 w-4" /> Call
                </Button>
              </a>
            )}
            {d.phone && (
              <a href={`sms:${d.phone}`}>
                <Button size="sm" variant="outline">
                  Text
                </Button>
              </a>
            )}
            {d.email && (
              <a href={`mailto:${d.email}`}>
                <Button size="sm" variant="outline">
                  <Mail className="h-4 w-4" /> Email
                </Button>
              </a>
            )}
          </div>
          <dl className="divide-y divide-border">
            <Row label="Phone">{d.phone}</Row>
            <Row label="Email">{d.email}</Row>
            <Row label="Where they stay">
              {d.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-muted" /> {d.location}
                </span>
              )}
            </Row>
            <Row label="Constituency">{d.constituency && <Link className="text-brand hover:underline" href={`/church/groups/${d.constituency.id}`}>{d.constituency.name}</Link>}</Row>
            <Row label="Basontas">
              {d.basontas.length > 0 &&
                d.basontas.map((b, i) => (
                  <span key={b.id}>
                    {i > 0 && ', '}
                    <Link className="text-brand hover:underline" href={`/church/groups/${b.id}`}>
                      {b.name}
                    </Link>
                  </span>
                ))}
            </Row>
            <Row label="Gender">{d.gender}</Row>
            <Row label="Date of birth">{d.dateOfBirth && `${formatDay(d.dateOfBirth)}${age !== null ? ` (${age})` : ''}`}</Row>
            <Row label="Joined">{d.joinedOn && formatDay(d.joinedOn)}</Row>
            <Row label="Notes">{d.notes && <span className="whitespace-pre-line">{d.notes}</span>}</Row>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">Attendance</h2>
          {d.history.length ? (
            <ul className="divide-y divide-border text-sm">
              {d.history.map((h) => (
                <li key={h.sessionId} className="flex items-center justify-between gap-2 py-2">
                  <span>{formatDay(h.date)}</span>
                  <span className="truncate text-muted">{h.kind === 'SUNDAY_SERVICE' ? 'Sunday service' : h.group?.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Not marked present anywhere yet.</p>
          )}
          {d.history.length >= 30 && <p className="mt-2 text-xs text-muted">Showing the latest 30.</p>}
        </Card>
      </div>
      {d.canEdit && (
        <div className="mt-6">
          <ConfirmButton
            variant="ghost"
            danger
            className="text-danger"
            title={`Delete ${d.fullName}?`}
            description="Their record and attendance history are removed permanently. To keep history, edit them and untick “Active member” instead."
            confirmLabel="Delete member"
            onConfirm={async () => {
              try {
                await api(`/members/${id}`, { method: 'DELETE' });
                toast.success(`${d.fullName} deleted`);
                void qc.invalidateQueries({ queryKey: ['members'] });
                void qc.invalidateQueries({ queryKey: ['groups'] });
                router.replace('/church/members');
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete member
          </ConfirmButton>
        </div>
      )}
      <MemberFormDialog open={editing} onOpenChange={setEditing} member={d} />
    </>
  );
}
