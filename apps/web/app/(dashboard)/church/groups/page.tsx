'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus, Users } from 'lucide-react';
import { GROUP_TYPE_LABELS, type GroupDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, GroupFormDialog, PastorCard, RolePermissionsCard } from '@/components/church/church-ui';
import { useMe } from '@/lib/queries';
import { formatDay, useGroups } from '@/lib/membership';
import { cn } from '@/lib/utils';

function GroupCard({ g }: { g: GroupDto }) {
  return (
    // The name link stretches over the whole card; the pastor's phone/email links sit above it.
    <Card className={cn('relative h-full min-w-0 space-y-3 p-4 transition-colors hover:border-brand/50', !g.isActive && 'opacity-60')}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-semibold">
            <Link href={`/church/groups/${g.id}`} className="after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-brand">
              {g.name}
            </Link>
          </h3>
          <div className="flex shrink-0 gap-1">
            {!g.isActive && <Badge tone="warning">Inactive</Badge>}
            {g.canAdminister ? <Badge tone="brand">Yours</Badge> : g.canManage ? <Badge tone="brand">Shepherding</Badge> : null}
          </div>
        </div>
        <PastorCard pastor={g.pastor} className="relative z-10 w-fit max-w-full" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {g.lastMeeting ? `${formatDay(g.lastMeeting.date)}: ${g.lastMeeting.present} present` : 'No meetings yet'}
          </span>
        </div>
    </Card>
  );
}

export default function GroupsPage() {
  const me = useMe();
  const groups = useGroups();
  const [tab, setTab] = useState<'CONSTITUENCY' | 'BASONTA'>('CONSTITUENCY');
  const [creating, setCreating] = useState(false);
  const p = me.data?.permissions;
  if (me.isLoading || groups.isLoading) return <PageLoader />;
  if (!p?.canViewMembership) return <EmptyState title="You don’t have access to church groups" />;
  const list = (groups.data ?? []).filter((g) => g.type === tab);
  return (
    <>
      <PageHeader
        title="Church"
        subtitle="Constituencies and basontas, their pastors and members."
        actions={
          p.canCreateGroup && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New group
            </Button>
          )
        }
      />
      <ChurchTabs />
      <div className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
        {(['CONSTITUENCY', 'BASONTA'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('rounded-md px-3 py-1.5 font-medium', tab === t ? 'bg-brand text-white' : 'text-muted hover:text-fg')}
            aria-pressed={tab === t}
          >
            {GROUP_TYPE_LABELS[t]}s ({(groups.data ?? []).filter((g) => g.type === t).length})
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Users className="h-8 w-8" />} title={`No ${GROUP_TYPE_LABELS[tab].toLowerCase()}s yet`}>
          {p.canCreateGroup ? 'Create the first one with “New group”.' : 'A pastor or Super Admin can create one.'}
        </EmptyState>
      )}
      {p.canManageRolePermissions && (
        <div className="mt-8">
          <RolePermissionsCard
            title="Who can see and manage church records"
            note="Super Admins can do everything. Pastors and shepherds can always view members; pastors create and lead their own groups; shepherds help run the groups they’re assigned to."
            permissions={['VIEW_MEMBERSHIP', 'MANAGE_MEMBERSHIP']}
          />
        </div>
      )}
      <GroupFormDialog open={creating} onOpenChange={setCreating} defaultType={tab} />
    </>
  );
}
