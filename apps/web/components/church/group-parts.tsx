'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cake, Check, MessageCircle, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { BACENTA_ROLE_SUGGESTIONS, GROUP_TYPE_LABELS, type GroupDto, type MemberDto, type UpcomingBirthdayDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fetchAll, mk, whatsappLink, type MemberPage } from '@/lib/membership';
import { cn } from '@/lib/utils';

const useGroupUpdate = (id: string) => {
  const qc = useQueryClient();
  return (g: GroupDto) => {
    qc.setQueryData(mk.group(id), g);
    void qc.invalidateQueries({ queryKey: ['groups'] });
    void qc.invalidateQueries({ queryKey: ['members'] });
  };
};

/** Suggested starter teams for a bacenta, matched by name (media, choir…). */
function suggestionsFor(name: string, existing: string[]): string[] {
  const key = Object.keys(BACENTA_ROLE_SUGGESTIONS).find((k) => name.toLowerCase().includes(k));
  return (key ? BACENTA_ROLE_SUGGESTIONS[key]! : []).filter((s) => !existing.some((e) => e.toLowerCase() === s.toLowerCase()));
}

/**
 * A bacenta's teams (mixing, projection, live streaming…), each with an optional team lead,
 * plus the bacenta's overall team lead.
 */
export function TeamsCard({ g }: { g: GroupDto }) {
  // Leads are picked from everyone in the bacenta (not just the first page).
  const all = useQuery({ queryKey: mk.members({ bacentaId: g.id, all: true }), queryFn: () => fetchAll<MemberDto>('/members', { bacentaId: g.id }) });
  const members = all.data ?? [];
  const update = useGroupUpdate(g.id);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const run = useMutation({
    mutationFn: (fn: () => Promise<GroupDto>) => fn(),
    onSuccess: update,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const add = (n: string) =>
    run.mutate(() => api<GroupDto>(`/groups/${g.id}/roles`, { method: 'POST', body: { name: n.trim() } }), { onSuccess: () => (setName(''), toast.success(`Team “${n.trim()}” added`)) });
  const suggestions = suggestionsFor(g.name, g.roles.map((r) => r.name));
  const options = members.map((m) => ({ id: m.id, name: m.fullName }));

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Team lead</h2>
        {g.canManage ? (
          <Select
            className="mt-2"
            value={g.lead?.id ?? ''}
            disabled={run.isPending}
            onChange={(e) =>
              run.mutate(() => api<GroupDto>(`/groups/${g.id}`, { method: 'PATCH', body: { leadMemberId: e.target.value || null } }), { onSuccess: () => toast.success('Team lead updated') })
            }
            aria-label={`${g.name} team lead`}
          >
            <option value="">{options.length ? 'No team lead yet' : 'Add members first'}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="mt-1 text-sm">{g.lead ? g.lead.fullName : <span className="text-muted">No team lead yet</span>}</p>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Teams ({g.roles.length})</h2>
        {g.roles.length ? (
          <ul className="space-y-3">
            {g.roles.map((r) => (
              <li key={r.id} className="space-y-1.5">
                {editing === r.id ? (
                  <form
                    className="flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run.mutate(() => api<GroupDto>(`/groups/${g.id}/roles/${r.id}`, { method: 'PATCH', body: { name: rename.trim() } }), { onSuccess: () => (setEditing(null), toast.success('Team renamed')) });
                    }}
                  >
                    <Input className="h-8 min-w-0 flex-1 text-sm" value={rename} maxLength={60} onChange={(e) => setRename(e.target.value)} autoFocus />
                    <Button size="icon" type="submit" aria-label="Save name" disabled={!rename.trim()}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className="shrink-0 text-xs text-muted">{r.memberCount}</span>
                    {g.canManage && (
                      <>
                        <button className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Rename ${r.name}`} onClick={() => (setEditing(r.id), setRename(r.name))}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                          aria-label={`Delete ${r.name}`}
                          onClick={() =>
                            window.confirm(`Delete the “${r.name}” team? Members stay in ${g.name}; they just lose this team.`) &&
                            run.mutate(() => api<GroupDto>(`/groups/${g.id}/roles/${r.id}`, { method: 'DELETE' }), { onSuccess: () => toast.success(`Team “${r.name}” deleted`) })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
                {g.canManage ? (
                  <Select
                    className="text-sm"
                    value={r.lead?.id ?? ''}
                    disabled={run.isPending}
                    onChange={(e) =>
                      run.mutate(() => api<GroupDto>(`/groups/${g.id}/roles/${r.id}`, { method: 'PATCH', body: { leadId: e.target.value || null } }), { onSuccess: () => toast.success(`${r.name} lead updated`) })
                    }
                    aria-label={`${r.name} team lead`}
                  >
                    <option value="">No {r.name.toLowerCase()} lead</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        Lead: {o.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  r.lead && <p className="text-xs text-muted">Lead: {r.lead.fullName}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No teams yet{g.canManage ? '. Add the teams people serve in, e.g. mixing, projection, live streaming.' : '.'}</p>
        )}
      </div>

      {g.canManage && (
        <div className="space-y-2 border-t border-border pt-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) add(name);
            }}
          >
            <Input className="min-w-0 flex-1" placeholder="New team, e.g. Live streaming" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" size="sm" disabled={!name.trim()} loading={run.isPending}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </form>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted">Suggestions:</span>
              {suggestions.map((s) => (
                <button key={s} type="button" className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:border-brand hover:text-brand" onClick={() => add(s)}>
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Pick which teams a member serves in within a bacenta. */
export function MemberTeamsDialog({ g, member, onClose }: { g: GroupDto; member: MemberDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    if (member) setSel(member.bacentas.find((b) => b.id === g.id)?.roles.map((r) => r.id) ?? []);
  }, [member, g.id]);
  const save = useMutation({
    mutationFn: () => api(`/groups/${g.id}/members/${member!.id}/roles`, { method: 'PUT', body: { roleIds: sel } }),
    onSuccess: () => {
      toast.success(`${member!.fullName}’s teams saved`);
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: mk.group(g.id) });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={member ? `${member.fullName}’s teams in ${g.name}` : ''}
      description="They can serve in more than one team."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      {g.roles.length ? (
        <div className="flex flex-wrap gap-2">
          {g.roles.map((r) => {
            const on = sel.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSel((s) => (on ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                className={cn('rounded-full border px-3 py-1.5 text-sm', on ? 'border-brand bg-brand text-white' : 'border-border text-muted hover:text-fg')}
              >
                {r.name}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">This bacenta has no teams yet. Add them in the Teams card first.</p>
      )}
    </Dialog>
  );
}

/** Search the directory and add someone who is already a member. */
export function AddExistingDialog({ g, open, onClose }: { g: GroupDto; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) (setQ(''), setRoleIds([]));
  }, [open]);
  const results = useQuery({
    queryKey: mk.members({ q: debounced, limit: 10, pick: g.id }),
    queryFn: () => api<MemberPage>('/members', { query: { q: debounced, limit: 10 } }),
    enabled: open && debounced.length >= 2,
  });
  const inGroup = (m: MemberDto) => (g.type === 'CONSTITUENCY' ? m.constituency?.id === g.id : g.type === 'BASONTA' ? m.basonta?.id === g.id : m.bacentas.some((b) => b.id === g.id));
  const add = useMutation({
    mutationFn: (m: MemberDto) => api(`/groups/${g.id}/members`, { method: 'POST', body: { memberId: m.id, ...(g.type === 'BACENTA' ? { roleIds } : {}) } }),
    onSuccess: (_, m) => {
      toast.success(`${m.fullName} added to ${g.name}`);
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['groups'] });
      void qc.invalidateQueries({ queryKey: mk.group(g.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const note =
    g.type === 'BACENTA'
      ? 'They keep their other bacentas.'
      : g.type === 'BASONTA'
        ? `This becomes their basonta${g.parent ? ` (and ${g.parent.name} their constituency)` : ''}, replacing any other.`
        : 'This becomes their constituency, replacing any other.';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={`Add an existing member to ${g.name}`} description={note}>
      <div className="space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="pl-9" placeholder="Search by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        {g.type === 'BACENTA' && g.roles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Teams:</span>
            {g.roles.map((r) => {
              const on = roleIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRoleIds((s) => (on ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-brand bg-brand text-white' : 'border-border text-muted hover:text-fg')}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
        {debounced.length < 2 ? (
          <p className="py-4 text-center text-sm text-muted">Type at least 2 letters.</p>
        ) : results.isLoading ? (
          <p className="py-4 text-center text-sm text-muted">Searching…</p>
        ) : results.data?.items.length ? (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {results.data.items.map((m) => {
              const already = inGroup(m);
              return (
                <li key={m.id} className="flex min-w-0 items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.fullName}</p>
                    <p className="truncate text-xs text-muted">{[m.phone, m.constituency?.name, m.basonta?.name, m.bacentas.map((b) => b.name).join(', ')].filter(Boolean).join(' · ') || m.churchRole}</p>
                  </div>
                  <Button size="sm" variant={already ? 'ghost' : 'outline'} disabled={already || add.isPending} onClick={() => add.mutate(m)}>
                    {already ? 'Already in' : 'Add'}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-muted">No one found. Use “New member” instead.</p>
        )}
      </div>
    </Dialog>
  );
}

/** A constituency's basontas (with "Add basonta" for its head pastor or admins). */
export function BasontasCard({ g, onAdd }: { g: GroupDto; onAdd?: () => void }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Basontas ({g.children.length})</h2>
        {g.canAdminister && onAdd && (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add {GROUP_TYPE_LABELS.BASONTA.toLowerCase()}
          </Button>
        )}
      </div>
      {g.children.length ? (
        <ul className="divide-y divide-border text-sm">
          {g.children.map((c) => (
            <li key={c.id}>
              <a href={`/church/groups/${c.id}`} className="flex min-w-0 items-center justify-between gap-2 py-2 hover:text-brand">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {c.pastor ?? 'No pastor'} · {c.memberCount}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No basontas yet.</p>
      )}
    </Card>
  );
}

/** Members of this group with a birthday in the next 30 days. */
export function BirthdaysCard({ groupId }: { groupId: string }) {
  const q = useQuery({ queryKey: ['group', groupId, 'birthdays'], queryFn: () => api<UpcomingBirthdayDto[]>(`/groups/${groupId}/birthdays`, { query: { days: 30 } }) });
  const list = q.data ?? [];
  const when = (n: number) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);
  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <Cake className="h-4 w-4" /> Upcoming birthdays
      </h2>
      {q.isLoading ? null : list.length ? (
        <ul className="divide-y divide-border text-sm">
          {list.slice(0, 8).map((b) => (
            <li key={b.id} className={cn('flex min-w-0 items-center gap-2 py-2', b.daysAway === 0 && 'rounded-lg bg-brand/5 px-2')}>
              <a href={`/church/members/${b.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium hover:text-brand">
                  {b.fullName}
                </p>
                <p className="truncate text-xs text-muted">
                  {when(b.daysAway)} · {new Date(`${b.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                  {b.turning ? ` · turns ${b.turning}` : ''}
                </p>
              </a>
              {b.phone && (
                <a
                  href={whatsappLink(b.phone, `Happy birthday, ${b.fullName.split(' ')[0]}! Wishing you a blessed year ahead.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg p-2 text-brand hover:bg-surface-2"
                  aria-label={`Send ${b.fullName} birthday wishes on WhatsApp`}
                  title="Send wishes on WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No birthdays in the next 30 days.</p>
      )}
      {list.length > 8 && <p className="text-xs text-muted">and {list.length - 8} more this month</p>}
    </Card>
  );
}
