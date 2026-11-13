'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Mail, MapPin, MessageCircle, Pencil, Phone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, MemberFormDialog } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { formatDay, mk, sessionName, whatsappLink, type MemberDetail } from '@/lib/membership';
import { GUEST_INTENT_LABELS } from '@wcc/shared';

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
              <a href={whatsappLink(d.phone, `Hello ${d.fullName.split(' ')[0]}, `)} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
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
            <Row label="Basonta">{d.basonta && <Link className="text-brand hover:underline" href={`/church/groups/${d.basonta.id}`}>{d.basonta.name}</Link>}</Row>
            <Row label="Bacentas">
              {d.bacentas.length > 0 && (
                <span className="space-y-1">
                  {d.bacentas.map((b) => (
                    <span key={b.id} className="block">
                      <Link className="text-brand hover:underline" href={`/church/groups/${b.id}`}>
                        {b.name}
                      </Link>
                      {b.roles.length > 0 && <span className="text-muted"> · {b.roles.map((r) => r.name).join(', ')}</span>}
                    </span>
                  ))}
                </span>
              )}
            </Row>
            <Row label="Gender">{d.gender}</Row>
            <Row label="Date of birth">{d.dateOfBirth && `${formatDay(d.dateOfBirth)}${age !== null ? ` (${age})` : ''}`}</Row>
            <Row label="Joined">{d.joinedOn && formatDay(d.joinedOn)}</Row>
            <Row label="Brought by">{d.broughtBy && <Link className="text-brand hover:underline" href={`/church/members/${d.broughtBy.id}`}>{d.broughtBy.fullName}</Link>}</Row>
            <Row label="Notes">{d.notes && <span className="whitespace-pre-line">{d.notes}</span>}</Row>
          </dl>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">Attendance</h2>
          {d.history.length ? (
            <ul className="divide-y divide-border text-sm">
              {d.history.map((h) => (
                <li key={h.sessionId}>
                  <Link href={`/church/attendance/s/${h.sessionId}`} className="flex min-w-0 items-center justify-between gap-2 py-2 hover:text-brand">
                    <span className="shrink-0">{formatDay(h.date)}</span>
                    <span className="min-w-0 truncate text-right text-muted">
                      {sessionName(h)}
                      {h.broughtCount ? ` · brought ${h.broughtCount}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Not marked present anywhere yet.</p>
          )}
          {d.history.length >= 30 && <p className="mt-2 text-xs text-muted">Showing the latest 30.</p>}
        </Card>
        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-2 font-semibold">People {d.fullName.split(' ')[0]} brought ({d.brought.length})</h2>
          {d.brought.length ? (
            <ul className="divide-y divide-border text-sm">
              {d.brought.map((g) => (
                <li key={g.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{g.fullName || 'Name not recorded'}</span>
                    {g.session && <span className="text-muted"> · {sessionName(g.session)} · {formatDay(g.session.date)}</span>}
                  </span>
                  {g.convertedMember ? (
                    <Link href={`/church/members/${g.convertedMember.id}`}>
                      <Badge tone="success">Now a member</Badge>
                    </Link>
                  ) : (
                    <Badge tone={g.intent === 'JOINING' ? 'brand' : 'neutral'}>{GUEST_INTENT_LABELS[g.intent]}</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nobody recorded yet.</p>
          )}
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
