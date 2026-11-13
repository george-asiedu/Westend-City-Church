'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, UserCog } from 'lucide-react';
import { ROLE_LABELS } from '@wcc/shared';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs } from '@/components/church/church-ui';
import { Stat } from '@/components/church/group-stats';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { formatDay, mk, type Leader } from '@/lib/membership';

const NEW_DAYS = 30;
const isNew = (iso: string) => Date.now() - Date.parse(iso) < NEW_DAYS * 86_400_000;

export default function LeadersPage() {
  const me = useMe();
  const q = useQuery({ queryKey: mk.leaders, queryFn: () => api<Leader[]>('/groups/leaders'), enabled: !!me.data?.permissions.canManageMembership });
  const [role, setRole] = useState<'all' | 'PASTOR' | 'SHEPHERD'>('all');
  const [show, setShow] = useState<'all' | 'new' | 'unassigned'>('all');
  const [term, setTerm] = useState('');
  if (me.isLoading) return <PageLoader />;
  if (!me.data?.permissions.canManageMembership) return <EmptyState title="Only Super Admins can see the list of pastors and shepherds" />;
  if (q.isLoading) return <PageLoader />;
  if (q.error) return <EmptyState title="Couldn’t load leaders">{errorMessage(q.error)}</EmptyState>;
  const all = q.data ?? [];
  const t = term.trim().toLowerCase();
  const list = all.filter(
    (l) =>
      (role === 'all' || l.role === role) &&
      (show === 'all' || (show === 'new' ? isNew(l.createdAt) : !l.leads.length && !l.shepherds.length)) &&
      (!t || [l.fullName, l.email, l.phone].some((v) => v?.toLowerCase().includes(t))),
  );
  const pastors = all.filter((l) => l.role === 'PASTOR');
  const shepherds = all.filter((l) => l.role === 'SHEPHERD');

  return (
    <>
      <PageHeader title="Church" subtitle="Every pastor and shepherd, and the groups they look after." />
      <ChurchTabs />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pastors" value={pastors.length} sub={`${pastors.filter((l) => isNew(l.createdAt)).length} new in the last ${NEW_DAYS} days`} />
        <Stat label="Shepherds" value={shepherds.length} sub={`${shepherds.filter((l) => isNew(l.createdAt)).length} new in the last ${NEW_DAYS} days`} />
        <Stat label="Leading no group" value={all.filter((l) => !l.leads.length && !l.shepherds.length).length} sub="Assign them from a group page" />
        <Stat label="Never signed in" value={all.filter((l) => !l.lastLoginAt).length} sub="Invited but not active yet" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3 [&>*]:min-w-0">
        <Input placeholder="Search name, email, phone…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)} aria-label="Role">
          <option value="all">Pastors and shepherds</option>
          <option value="PASTOR">Pastors</option>
          <option value="SHEPHERD">Shepherds</option>
        </Select>
        <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
          <option value="all">Everyone</option>
          <option value="new">New (last {NEW_DAYS} days)</option>
          <option value="unassigned">Not leading a group</option>
        </Select>
      </div>
      {list.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((l) => (
            <Card key={l.id} className="min-w-0 space-y-3 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {l.title ? `${l.title} ` : ''}
                    {l.fullName}
                  </p>
                  <p className="text-xs text-muted">
                    Joined {formatDay(l.createdAt.slice(0, 10))} · {l.lastLoginAt ? `last signed in ${formatDay(l.lastLoginAt.slice(0, 10))}` : 'never signed in'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Badge tone={l.role === 'SHEPHERD' ? 'neutral' : 'brand'}>{ROLE_LABELS[l.role]}</Badge>
                  {isNew(l.createdAt) && <Badge tone="success">New</Badge>}
                  {l.status !== 'ACTIVE' && <Badge tone="warning">{l.status.toLowerCase()}</Badge>}
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {l.phone && (
                  <a href={`tel:${l.phone}`} className="flex items-center gap-2 text-brand hover:underline">
                    <Phone className="h-4 w-4 shrink-0" /> {l.phone}
                  </a>
                )}
                <a href={`mailto:${l.email}`} className="flex min-w-0 items-center gap-2 text-brand hover:underline">
                  <Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{l.email}</span>
                </a>
              </div>
              <div className="space-y-1.5 border-t border-border pt-3 text-sm">
                {l.leads.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted">Leads:</span>
                    {l.leads.map((g) => (
                      <Link key={g.id} href={`/church/groups/${g.id}`}>
                        <Badge tone="brand">{g.name}</Badge>
                      </Link>
                    ))}
                  </p>
                )}
                {l.shepherds.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted">Shepherds:</span>
                    {l.shepherds.map((g) => (
                      <Link key={g.id} href={`/church/groups/${g.id}`}>
                        <Badge>{g.name}</Badge>
                      </Link>
                    ))}
                  </p>
                )}
                {!l.leads.length && !l.shepherds.length && <p className="text-muted">Not leading or shepherding a group yet.</p>}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={<UserCog className="h-8 w-8" />} title={all.length ? 'No one matches' : 'No pastors or shepherds yet'}>
          {all.length ? null : 'Invite people with the Pastor or Shepherd role from Admin → Users.'}
        </EmptyState>
      )}
    </>
  );
}
