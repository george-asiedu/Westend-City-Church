'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Phone, Plus, Users } from 'lucide-react';
import type { MemberDto } from '@wcc/shared';
import { Pager } from '@/components/ui/pager';
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/table';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, MemberFormDialog } from '@/components/church/church-ui';
import { errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { bacentaLabel, canAddMembers, downloadCsv, fetchAll, formatDay, mk, useCursorList, useGroups } from '@/lib/membership';

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
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = { q: debounced, constituencyId, basontaId, bacentaId, status };
  const members = useCursorList<MemberDto>(mk.members(params), '/members', params);
  const p = me.data?.permissions;
  if (me.isLoading) return <PageLoader />;
  if (!p?.canViewMembership) return <EmptyState title="You don’t have access to member records" />;
  const items = members.items;

  const exportAll = async () => {
    setExporting(true);
    try {
      const all = { items: await fetchAll<MemberDto>('/members', params) };
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
      toast.success(`Exported ${all.items.length} members`);
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
        <Select value={constituencyId} onChange={(e) => setConstituencyId(e.target.value)} aria-label="Constituency">
          <option value="">All constituencies</option>
          <option value="none">No constituency</option>
          {constituencies.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={basontaId} onChange={(e) => setBasontaId(e.target.value)} aria-label="Basonta">
          <option value="">All basontas</option>
          <option value="none">No basonta</option>
          {basontas.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.parent ? ` (${b.parent.name})` : ''}
            </option>
          ))}
        </Select>
        <Select value={bacentaId} onChange={(e) => setBacentaId(e.target.value)} aria-label="Bacenta">
          <option value="">All bacentas</option>
          {bacentas.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="active">Active members</option>
          <option value="inactive">Inactive</option>
          <option value="all">Everyone</option>
        </Select>
      </div>

      {members.isLoading ? (
        <PageLoader />
      ) : items.length ? (
        <Card className="overflow-hidden">
          <p className="border-b border-border px-4 py-2 text-xs text-muted">
            {members.total ?? items.length} member{members.total === 1 ? '' : 's'}
          </p>
          {/* Table on wide screens, list on phones. */}
          <div className="hidden p-3 md:block">
            <Table>
              <THead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Phone</Th>
                  <Th>Where they stay</Th>
                  <Th>Constituency</Th>
                  <Th>Basonta</Th>
                  <Th>Bacentas</Th>
                  <Th>Last seen</Th>
                </tr>
              </THead>
              <TBody>
                {items.map((m) => (
                  <Tr key={m.id}>
                    <Td>
                      <Link href={`/church/members/${m.id}`} className="font-medium hover:text-brand">
                        {m.fullName}
                      </Link>
                      {!m.isActive && <Badge tone="warning" className="ml-2">Inactive</Badge>}
                    </Td>
                    <Td>{m.churchRole}</Td>
                    <Td className="whitespace-nowrap">{m.phone ? <a href={`tel:${m.phone}`} className="text-brand hover:underline">{m.phone}</a> : '—'}</Td>
                    <Td>{m.location ?? '—'}</Td>
                    <Td>{m.constituency?.name ?? '—'}</Td>
                    <Td>{m.basonta?.name ?? '—'}</Td>
                    <Td className="max-w-xs whitespace-normal">{m.bacentas.map(bacentaLabel).join(', ') || '—'}</Td>
                    <Td className="whitespace-nowrap text-muted">{m.lastSeen ? formatDay(m.lastSeen) : 'Never'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="divide-y divide-border md:hidden">
            {items.map((m, i) => (
              <li key={m.id} className={cn('flex min-w-0 items-center gap-3 px-4 py-3', i % 2 === 1 && 'bg-surface-2/50')}>
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
          <div className="border-t border-border">
            <Pager list={members} />
          </div>
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
