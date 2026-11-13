'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Phone, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, MemberFormDialog } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { bacentaLabel, canAddMembers, downloadCsv, formatDay, mk, useGroups, type MemberPage } from '@/lib/membership';

export default function MembersPage() {
  const me = useMe();
  const constituencies = useGroups('CONSTITUENCY');
  const basontas = useGroups('BASONTA');
  const bacentas = useGroups('BACENTA');
  const [bacentaId, setBacentaId] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [constituencyId, setConstituencyId] = useState('');
  const [basontaId, setBasontaId] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => (setDebounced(q.trim()), setPage(1)), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = { q: debounced, constituencyId, basontaId, bacentaId, status, page, limit: 50 };
  const members = useQuery({ queryKey: mk.members(params), queryFn: () => api<MemberPage>('/members', { query: params }), placeholderData: keepPreviousData });
  const p = me.data?.permissions;
  if (me.isLoading) return <PageLoader />;
  if (!p?.canViewMembership) return <EmptyState title="You don’t have access to member records" />;
  const data = members.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = await api<MemberPage>('/members', { query: { ...params, page: 1, limit: 500 } });
      downloadCsv('members.csv', [
        ['Name', 'Role', 'Phone', 'Email', 'Gender', 'Where they stay', 'Constituency', 'Basonta', 'Bacentas (teams)', 'Date of birth', 'Joined', 'Active', 'Last seen'],
        ...all.items.map((m) => [
          m.fullName,
          m.churchRole,
          m.phone,
          m.email,
          m.gender,
          m.location,
          m.constituency?.name,
          m.basonta?.name,
          m.bacentas.map(bacentaLabel).join('; '),
          m.dateOfBirth,
          m.joinedOn,
          m.isActive ? 'Yes' : 'No',
          m.lastSeen,
        ]),
      ]);
      toast.success(all.total > all.items.length ? `Exported the first ${all.items.length} of ${all.total} members` : `Exported ${all.items.length} members`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Church"
        subtitle="Everyone in the church directory."
        actions={
          <>
            <Button variant="outline" loading={exporting} onClick={exportAll}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            {canAddMembers(me.data!) && (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add member
              </Button>
            )}
          </>
        }
      />
      <ChurchTabs />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5 [&>*]:min-w-0">
        <Input placeholder="Search name, phone, area, role…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={constituencyId} onChange={(e) => (setConstituencyId(e.target.value), setPage(1))} aria-label="Constituency">
          <option value="">All constituencies</option>
          <option value="none">No constituency</option>
          {constituencies.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={basontaId} onChange={(e) => (setBasontaId(e.target.value), setPage(1))} aria-label="Basonta">
          <option value="">All basontas</option>
          <option value="none">No basonta</option>
          {basontas.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.parent ? ` (${b.parent.name})` : ''}
            </option>
          ))}
        </Select>
        <Select value={bacentaId} onChange={(e) => (setBacentaId(e.target.value), setPage(1))} aria-label="Bacenta">
          <option value="">All bacentas</option>
          {bacentas.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => (setStatus(e.target.value as typeof status), setPage(1))} aria-label="Status">
          <option value="active">Active members</option>
          <option value="inactive">Inactive</option>
          <option value="all">Everyone</option>
        </Select>
      </div>

      {!data ? (
        <PageLoader />
      ) : data.items.length ? (
        <Card className="overflow-hidden">
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            {data.total} member{data.total === 1 ? '' : 's'}
          </p>
          {/* Table on wide screens, list on phones. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                  <th className="px-4 py-2 font-medium">Where they stay</th>
                  <th className="px-4 py-2 font-medium">Constituency</th>
                  <th className="px-4 py-2 font-medium">Basonta</th>
                  <th className="px-4 py-2 font-medium">Bacentas</th>
                  <th className="px-4 py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/church/members/${m.id}`} className="font-medium hover:text-brand">
                        {m.fullName}
                      </Link>
                      {!m.isActive && <Badge tone="warning" className="ml-2">Inactive</Badge>}
                    </td>
                    <td className="px-4 py-2.5">{m.churchRole}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{m.phone ? <a href={`tel:${m.phone}`} className="text-brand hover:underline">{m.phone}</a> : '—'}</td>
                    <td className="px-4 py-2.5">{m.location ?? '—'}</td>
                    <td className="px-4 py-2.5">{m.constituency?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">{m.basonta?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">{m.bacentas.map(bacentaLabel).join(', ') || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{m.lastSeen ? formatDay(m.lastSeen) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-border md:hidden">
            {data.items.map((m) => (
              <li key={m.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                <Link href={`/church/members/${m.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.fullName} {!m.isActive && <Badge tone="warning">Inactive</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[m.churchRole, m.basonta?.name ?? m.constituency?.name, m.bacentas.map((b) => b.name).join(', '), m.location].filter(Boolean).join(' · ')}
                  </p>
                </Link>
                {m.phone && (
                  <a href={`tel:${m.phone}`} className="shrink-0 rounded-lg p-2 text-brand hover:bg-surface-2" aria-label={`Call ${m.fullName}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <span className="text-muted">
                Page {page} of {pages}
              </span>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <EmptyState icon={<Users className="h-8 w-8" />} title={debounced || constituencyId || basontaId || bacentaId ? 'No members match' : 'No members yet'}>
          {canAddMembers(me.data!) && !debounced ? 'Add members here, or from a constituency or basonta page.' : null}
        </EmptyState>
      )}
      <MemberFormDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
