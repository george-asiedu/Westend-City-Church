'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, Download, MapPin, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { GROUP_TYPE_LABELS, type GroupDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, GroupFormDialog, MemberFormDialog, PastorCard } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { downloadCsv, formatDay, localDate, mk, type MemberPage, type SessionRow } from '@/lib/membership';

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const group = useQuery({ queryKey: mk.group(id), queryFn: () => api<GroupDto & { createdAt: string }>(`/groups/${id}`) });
  const g = group.data;
  const filter = g ? (g.type === 'CONSTITUENCY' ? { constituencyId: id } : { basontaId: id }) : {};
  const members = useQuery({
    queryKey: mk.members({ ...filter, limit: 500 }),
    queryFn: () => api<MemberPage>('/members', { query: { ...filter, limit: 500 } }),
    enabled: !!g,
  });
  const sessions = useQuery({ queryKey: mk.sessions({ groupId: id }), queryFn: () => api<SessionRow[]>('/attendance/sessions', { query: { groupId: id } }), enabled: !!g });

  if (group.isLoading) return <PageLoader />;
  if (!g) return <EmptyState title="Group not found">{group.error ? errorMessage(group.error) : null}</EmptyState>;
  const term = q.trim().toLowerCase();
  const list = (members.data?.items ?? []).filter((m) => !term || [m.fullName, m.phone, m.location, m.churchRole].some((v) => v?.toLowerCase().includes(term)));
  const takeHref = `/church/attendance/take?kind=GROUP_MEETING&groupId=${id}&date=${localDate()}`;

  return (
    <>
      <PageHeader
        title={g.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{GROUP_TYPE_LABELS[g.type]}</Badge>
            {!g.isActive && <Badge tone="warning">Inactive</Badge>}
            {g.meetingDay && <span>Meets {g.meetingDay}</span>}
            {g.meetingPlace && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {g.meetingPlace}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {g.canManage && (
              <Link href={takeHref}>
                <Button>
                  <ClipboardCheck className="h-4 w-4" /> Take attendance
                </Button>
              </Link>
            )}
            {g.canManage && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
          </>
        }
      >
        <Link href="/church/groups" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> All groups
        </Link>
      </PageHeader>
      <ChurchTabs />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Pastor</h2>
            <PastorCard pastor={g.pastor} />
          </Card>
          {g.description && (
            <Card className="p-4 text-sm">
              <p className="whitespace-pre-line">{g.description}</p>
            </Card>
          )}
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Meetings</h2>
            {sessions.data?.length ? (
              <ul className="divide-y divide-border text-sm">
                {sessions.data.slice(0, 12).map((s) => (
                  <li key={s.id}>
                    <Link href={`/church/attendance/take?kind=GROUP_MEETING&groupId=${id}&date=${s.date}`} className="flex items-center justify-between py-2 hover:text-brand">
                      <span>{formatDay(s.date)}</span>
                      <span className="text-muted">
                        {s.present}/{g.memberCount} present{s.visitors ? ` · ${s.visitors} visitors` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No meetings recorded yet.</p>
            )}
          </Card>
          {g.canManage && (
            <ConfirmButton
              variant="ghost"
              danger
              className="text-danger"
              title={`Delete ${g.name}?`}
              description={`Members are kept${g.type === 'CONSTITUENCY' ? ' but will have no constituency' : ''}. This group’s meeting attendance history is deleted. This cannot be undone. To keep the history, edit the group and mark it inactive instead.`}
              confirmLabel="Delete group"
              onConfirm={async () => {
                try {
                  await api(`/groups/${id}`, { method: 'DELETE' });
                  toast.success(`${g.name} deleted`);
                  void qc.invalidateQueries({ queryKey: ['groups'] });
                  router.replace('/church/groups');
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete group
            </ConfirmButton>
          )}
        </div>

        <Card className="space-y-3 p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">Members ({members.data?.total ?? g.memberCount})</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={!members.data?.items.length}
              onClick={() =>
                downloadCsv(`${g.name} members.csv`, [
                  ['Name', 'Role', 'Phone', 'Where they stay', 'Constituency', 'Basontas', 'Last seen'],
                  ...(members.data?.items ?? []).map((m) => [m.fullName, m.churchRole, m.phone, m.location, m.constituency?.name, m.basontas.map((b) => b.name).join('; '), m.lastSeen]),
                ])
              }
            >
              <Download className="h-4 w-4" /> CSV
            </Button>
            {g.canManage && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add member
              </Button>
            )}
          </div>
          <Input placeholder="Search name, phone, area, role…" value={q} onChange={(e) => setQ(e.target.value)} />
          {members.isLoading ? (
            <PageLoader />
          ) : list.length ? (
            <ul className="divide-y divide-border">
              {list.map((m) => (
                <li key={m.id} className="flex min-w-0 items-center gap-3 py-2.5">
                  <Link href={`/church/members/${m.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium hover:text-brand">{m.fullName}</p>
                    <p className="truncate text-xs text-muted">
                      {m.churchRole}
                      {m.location ? ` · ${m.location}` : ''}
                      {g.type === 'BASONTA' && m.constituency ? ` · ${m.constituency.name}` : ''}
                    </p>
                  </Link>
                  {m.phone && (
                    <a href={`tel:${m.phone}`} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm text-brand hover:bg-surface-2" aria-label={`Call ${m.fullName}`}>
                      <Phone className="h-4 w-4" /> <span className="hidden sm:inline">{m.phone}</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted">{term ? 'No members match.' : 'No members yet.'}</p>
          )}
        </Card>
      </div>

      <GroupFormDialog open={editing} onOpenChange={setEditing} group={g} />
      <MemberFormDialog
        open={adding}
        onOpenChange={setAdding}
        defaults={g.type === 'CONSTITUENCY' ? { constituencyId: g.id } : { basontaIds: [g.id] }}
      />
    </>
  );
}
