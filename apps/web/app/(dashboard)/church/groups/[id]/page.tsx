'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, ClipboardCheck, Download, MapPin, Pencil, Phone, Plus, Tags, Trash2, UserMinus, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { GROUP_TYPE_LABELS, type GroupDto, type MemberDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { ChurchTabs, GroupFormDialog, MemberFormDialog, PastorCard } from '@/components/church/church-ui';
import { GroupStatsPanel } from '@/components/church/group-stats';
import { AddExistingDialog, BasontasCard, MemberTeamsDialog, TeamsCard } from '@/components/church/group-parts';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { bacentaLabel, downloadCsv, fetchAll, formatDay, memberDefaultsFor, mk, sessionName, useCursorList, useGroups, useShepherdCandidates, type SessionRow } from '@/lib/membership';
import { LoadMore } from '@/components/ui/load-more';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';

const isLeaderRole = (r: string) => /shepherd|leader|pastor|overseer/i.test(r);

/** Move a member from this group to another of the same kind (e.g. choir → media). */
function MoveDialog({ member, group, onClose }: { member: MemberDto | null; group: GroupDto; onClose: () => void }) {
  const qc = useQueryClient();
  const groups = useGroups(group.type);
  const [to, setTo] = useState('');
  const options = (groups.data ?? []).filter((g) => g.id !== group.id && g.isActive);
  const move = useMutation({
    mutationFn: () => api(`/members/${member!.id}/move`, { method: 'POST', body: { fromGroupId: group.id, toGroupId: to } }),
    onSuccess: () => {
      toast.success(`${member!.fullName} moved to ${options.find((g) => g.id === to)?.name}`);
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['groups'] });
      void qc.invalidateQueries({ queryKey: ['group'] });
      setTo('');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => !o && (setTo(''), onClose())}
      title={member ? `Move ${member.fullName}` : ''}
      description={`From ${group.name} to another ${GROUP_TYPE_LABELS[group.type].toLowerCase()}. Their attendance history stays.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={move.isPending} disabled={!to} onClick={() => move.mutate()}>
            Move
          </Button>
        </>
      }
    >
      <Field label={`New ${GROUP_TYPE_LABELS[group.type].toLowerCase()}`} htmlFor="mv-to">
        <Select id="mv-to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      {group.type === 'BACENTA' && <p className="mt-3 text-xs text-muted">Their teams in {group.name} don’t carry over. To serve in another bacenta as well, use “Existing member” there instead.</p>}
      {group.type === 'BASONTA' && <p className="mt-3 text-xs text-muted">Moving to a basonta in another constituency moves their constituency too.</p>}
    </Dialog>
  );
}

function ShepherdsCard({ g }: { g: GroupDto }) {
  const qc = useQueryClient();
  const candidates = useShepherdCandidates(g.canAdminister);
  const [pick, setPick] = useState('');
  const update = (r: GroupDto) => qc.setQueryData(mk.group(g.id), r);
  const add = useMutation({
    mutationFn: () => api<GroupDto>(`/groups/${g.id}/shepherds`, { method: 'POST', body: { userId: pick } }),
    onSuccess: (r) => (update(r), setPick(''), toast.success('Shepherd added')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api<GroupDto>(`/groups/${g.id}/shepherds/${userId}`, { method: 'DELETE' }),
    onSuccess: (r) => (update(r), toast.success('Shepherd removed')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const available = (candidates.data ?? []).filter((c) => !g.shepherds.some((s) => s.id === c.id) && c.id !== g.pastor?.id);
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Shepherds ({g.shepherds.length})</h2>
      {g.shepherds.length ? (
        <ul className="space-y-3">
          {g.shepherds.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <PastorCard pastor={s} className="flex-1" />
              {g.canAdminister && (
                <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger" aria-label={`Remove ${s.fullName}`} onClick={() => remove.mutate(s.id)}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No shepherds yet.</p>
      )}
      {g.canAdminister && (
        <div className="flex gap-2 border-t border-border pt-3">
          <Select className="min-w-0 flex-1" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a shepherd">
            <option value="">{available.length ? 'Add a shepherd…' : 'No users with the Shepherd role yet'}</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!pick} loading={add.isPending} onClick={() => add.mutate()}>
            Add
          </Button>
        </div>
      )}
      {g.canAdminister && <p className="text-xs text-muted">Shepherds can take attendance and manage members of this group. Give someone the Shepherd role in Admin → Users.</p>}
    </Card>
  );
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [tab, setTab] = useState<'members' | 'stats'>('members');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<MemberDto | null>(null);
  const [q, setQ] = useState('');
  const [leadersOnly, setLeadersOnly] = useState(false);
  const [team, setTeam] = useState('');
  const [addingExisting, setAddingExisting] = useState(false);
  const [addingBasonta, setAddingBasonta] = useState(false);
  const [teamsFor, setTeamsFor] = useState<MemberDto | null>(null);
  const group = useQuery({ queryKey: mk.group(id), queryFn: () => api<GroupDto & { createdAt: string }>(`/groups/${id}`) });
  const g = group.data;
  const filter = g ? (g.type === 'CONSTITUENCY' ? { constituencyId: id } : g.type === 'BASONTA' ? { basontaId: id } : { bacentaId: id }) : {};
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // Searching and filtering happen on the server; 20 members at a time.
  const listQuery = { ...filter, q: debounced || undefined, leaders: leadersOnly || undefined, teamRoleId: team || undefined };
  const members = useCursorList<MemberDto>(mk.members(listQuery), '/members', listQuery, !!g);
  const sessions = useCursorList<SessionRow>(mk.sessions({ groupId: id }), '/attendance/sessions', { groupId: id }, !!g && g.type !== 'CONSTITUENCY');

  if (group.isLoading) return <PageLoader />;
  if (!g) return <EmptyState title="Group not found">{group.error ? errorMessage(group.error) : null}</EmptyState>;
  const canStats = g.canManage || !!me.data?.permissions.canViewChurchStats;
  const term = debounced;
  const list = members.items;
  const teamsOf = (m: MemberDto) => m.bacentas.find((b) => b.id === id)?.roles ?? [];

  return (
    <>
      <PageHeader
        title={g.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{GROUP_TYPE_LABELS[g.type]}</Badge>
            {g.parent && (
              <span>
                in{' '}
                <Link className="text-brand hover:underline" href={`/church/groups/${g.parent.id}`}>
                  {g.parent.name}
                </Link>
              </span>
            )}
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
            {g.canManage && g.type !== 'CONSTITUENCY' && (
              <Link href={`/church/attendance/new?groupId=${id}`}>
                <Button>
                  <ClipboardCheck className="h-4 w-4" /> Take attendance
                </Button>
              </Link>
            )}
            {g.canAdminister && (
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

      {canStats && (
        <div className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {(['members', 'stats'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={cn('rounded-md px-3 py-1.5 font-medium', tab === t ? 'bg-brand text-white' : 'text-muted hover:text-fg')}>
              {t === 'members' ? 'Members & meetings' : 'Statistics'}
            </button>
          ))}
        </div>
      )}

      {tab === 'stats' && canStats ? (
        <GroupStatsPanel groupId={id} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{g.type === 'CONSTITUENCY' ? 'Head pastor' : 'Pastor'}</h2>
              <PastorCard pastor={g.pastor} />
              {g.parent && (
                <div className="space-y-2 border-t border-border pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Head pastor of {g.parent.name}</h3>
                  <PastorCard pastor={g.parent.pastor} />
                </div>
              )}
            </Card>
            {g.type === 'CONSTITUENCY' && <BasontasCard g={g} onAdd={() => setAddingBasonta(true)} />}
            {g.type === 'BACENTA' && <TeamsCard g={g} />}
            <ShepherdsCard g={g} />
            {g.description && (
              <Card className="p-4 text-sm">
                <p className="whitespace-pre-line">{g.description}</p>
              </Card>
            )}
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Meetings</h2>
              {g.type === 'CONSTITUENCY' ? (
                <p className="text-sm text-muted">
                  A constituency’s attendance is the total of its basontas. See it under Statistics, or on the Attendance tab’s “By constituency”.
                </p>
              ) : sessions.items.length ? (
                <>
                <ul className="divide-y divide-border text-sm">
                  {sessions.items.map((s) => (
                    <li key={s.id}>
                      <Link href={`/church/attendance/s/${s.id}`} className="flex min-w-0 items-center justify-between gap-2 py-2 hover:text-brand">
                        <span className="min-w-0 truncate">
                          {formatDay(s.date)}
                          <span className="text-muted"> · {sessionName({ ...s, group: null })}</span>
                        </span>
                        <span className="shrink-0 text-muted">
                          {s.present}/{g.memberCount}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <LoadMore hasMore={!!sessions.hasNextPage} loading={sessions.isFetchingNextPage} onClick={sessions.more} shown={sessions.items.length} />
                </>
              ) : (
                <p className="text-sm text-muted">No meetings recorded yet.</p>
              )}
            </Card>
            {g.canAdminister && (
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
              <h2 className="mr-auto font-semibold">Members ({g.memberCount})</h2>
              <Button
                size="sm"
                variant="outline"
                disabled={!g.memberCount}
                onClick={async () => {
                  const all = await fetchAll<MemberDto>('/members', filter);
                  downloadCsv(`${g.name} members.csv`, [
                    ['Name', 'Role', ...(g.type === 'BACENTA' ? ['Teams'] : []), 'Phone', 'Where they stay', 'Constituency', 'Basonta', 'Bacentas', 'Last seen'],
                    ...all.map((m) => [
                      m.fullName,
                      m.churchRole,
                      ...(g.type === 'BACENTA' ? [teamsOf(m).map((r) => r.name).join('; ')] : []),
                      m.phone,
                      m.location,
                      m.constituency?.name,
                      m.basonta?.name,
                      m.bacentas.map(bacentaLabel).join('; '),
                      m.lastSeen,
                    ]),
                  ]);
                }}
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
              {g.canManage && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setAddingExisting(true)}>
                    <UserPlus className="h-4 w-4" /> Existing member
                  </Button>
                  <Button size="sm" onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> New member
                  </Button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-0 flex-1" placeholder="Search name, phone, area, role…" value={q} onChange={(e) => setQ(e.target.value)} />
              {g.type === 'BACENTA' && g.roles.length > 0 && (
                <Select className="w-full sm:w-48" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
                  <option value="">All teams</option>
                  {g.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.memberCount})
                    </option>
                  ))}
                  <option value="none">No team yet</option>
                </Select>
              )}
              <div className="inline-flex shrink-0 rounded-lg border border-border p-0.5 text-sm">
                <button onClick={() => setLeadersOnly(false)} aria-pressed={!leadersOnly} className={cn('rounded-md px-3 py-1.5', !leadersOnly ? 'bg-surface-2 font-medium' : 'text-muted')}>
                  All
                </button>
                <button onClick={() => setLeadersOnly(true)} aria-pressed={leadersOnly} className={cn('rounded-md px-3 py-1.5', leadersOnly ? 'bg-surface-2 font-medium' : 'text-muted')}>
                  Shepherds & leaders
                </button>
              </div>
            </div>
            {members.isLoading ? (
              <PageLoader />
            ) : list.length ? (
              <ul className="divide-y divide-border">
                {list.map((m) => (
                  <li key={m.id} className="flex min-w-0 items-center gap-2 py-2.5">
                    <Link href={`/church/members/${m.id}`} className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium hover:text-brand">{m.fullName}</span>
                        {isLeaderRole(m.churchRole) && <Badge tone="brand" className="shrink-0 whitespace-nowrap">{m.churchRole}</Badge>}
                        {g.lead?.id === m.id && <Badge tone="success" className="shrink-0 whitespace-nowrap">Team lead</Badge>}
                      </p>
                      {g.type === 'BACENTA' && teamsOf(m).length > 0 && (
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {teamsOf(m).map((r) => (
                            <span key={r.id} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                              {r.name}
                              {g.roles.find((x) => x.id === r.id)?.lead?.id === m.id ? ' · lead' : ''}
                            </span>
                          ))}
                        </p>
                      )}
                      <p className="truncate text-xs text-muted">
                        {isLeaderRole(m.churchRole) ? '' : m.churchRole}
                        {m.location ? `${isLeaderRole(m.churchRole) ? '' : ' · '}${m.location}` : ''}
                        {g.type === 'BACENTA' && (m.basonta || m.constituency) ? ` · ${m.basonta?.name ?? m.constituency?.name}` : ''}
                      </p>
                    </Link>
                    {m.phone && (
                      <a href={`tel:${m.phone}`} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm text-brand hover:bg-surface-2" aria-label={`Call ${m.fullName}`}>
                        <Phone className="h-4 w-4" /> <span className="hidden sm:inline">{m.phone}</span>
                      </a>
                    )}
                    {g.canManage && g.type === 'BACENTA' && (
                      <button className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Teams for ${m.fullName}`} title="Teams" onClick={() => setTeamsFor(m)}>
                        <Tags className="h-4 w-4" />
                      </button>
                    )}
                    {g.canManage && (
                      <button className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Move ${m.fullName}`} title="Move to another group" onClick={() => setMoving(m)}>
                        <ArrowRightLeft className="h-4 w-4" />
                      </button>
                    )}
                    {g.canManage && g.type === 'BACENTA' && (
                      <button
                        className="shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger"
                        aria-label={`Remove ${m.fullName} from ${g.name}`}
                        title={`Remove from ${g.name}`}
                        onClick={async () => {
                          if (!window.confirm(`Remove ${m.fullName} from ${g.name}? They stay a church member.`)) return;
                          try {
                            await api(`/groups/${id}/members/${m.id}`, { method: 'DELETE' });
                            toast.success(`${m.fullName} removed from ${g.name}`);
                            void qc.invalidateQueries({ queryKey: ['members'] });
                            void qc.invalidateQueries({ queryKey: mk.group(id) });
                          } catch (e) {
                            toast.error(errorMessage(e));
                          }
                        }}
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {!members.isLoading && list.length > 0 && <LoadMore hasMore={!!members.hasNextPage} loading={members.isFetchingNextPage} onClick={members.more} shown={list.length} total={members.total} />}
            {!members.isLoading && !list.length && (
              <p className="py-6 text-center text-sm text-muted">{term || leadersOnly || team ? 'No members match.' : 'No members yet.'}</p>
            )}
          </Card>
        </div>
      )}

      <GroupFormDialog open={editing} onOpenChange={setEditing} group={g} />
      <MemberFormDialog open={adding} onOpenChange={setAdding} defaults={memberDefaultsFor(g)} />
      <MoveDialog member={moving} group={g} onClose={() => setMoving(null)} />
      <AddExistingDialog g={g} open={addingExisting} onClose={() => setAddingExisting(false)} />
      <MemberTeamsDialog g={g} member={teamsFor} onClose={() => setTeamsFor(null)} />
      <GroupFormDialog open={addingBasonta} onOpenChange={setAddingBasonta} defaultType="BASONTA" defaultParentId={g.id} />
    </>
  );
}
