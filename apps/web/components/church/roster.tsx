'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, Plus, X } from 'lucide-react';
import type { GroupDto, MemberDto, RosterSlotDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { fetchAll, formatDay, localDate } from '@/lib/membership';

/** A bacenta's duty rota for the next 8 weeks. The evening before, people on it get a reminder. */
export function RosterCard({ g }: { g: GroupDto }) {
  const qc = useQueryClient();
  const key = ['roster', g.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<RosterSlotDto[]>(`/groups/${g.id}/roster`) });
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/groups/${g.id}/roster/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const byDay = new Map<string, RosterSlotDto[]>();
  for (const s of q.data ?? []) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);

  return (
    <Card className="space-y-3 p-4" data-roster>
      <div className="flex items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <CalendarCheck className="h-4 w-4" /> Rota
        </h2>
        {g.canManage && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </div>
      {!byDay.size ? (
        <p className="text-sm text-muted">{q.isLoading ? 'Loading…' : 'Nobody on the rota for the next 8 weeks.'}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {[...byDay].map(([day, slots]) => (
            <li key={day}>
              <p className="text-xs font-medium text-muted">{formatDay(day)}</p>
              <ul>
                {slots.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-0.5">
                    <span className="min-w-0 flex-1 truncate">
                      {s.member.fullName}
                      <span className="text-muted">{[s.role?.name, s.service].filter(Boolean).length ? ` · ${[s.role?.name, s.service].filter(Boolean).join(', ')}` : ''}</span>
                    </span>
                    {g.canManage && (
                      <button className="rounded p-0.5 text-muted hover:text-danger" aria-label={`Take ${s.member.fullName} off the rota`} onClick={() => remove.mutate(s.id)}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">People on the rota get a reminder the evening before (if they have the app with notifications on).</p>
      {g.canManage && <AddDialog g={g} open={open} onOpenChange={setOpen} onSaved={() => qc.invalidateQueries({ queryKey: key })} />}
    </Card>
  );
}

function AddDialog({ g, open, onOpenChange, onSaved }: { g: GroupDto; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [date, setDate] = useState('');
  const [roleId, setRoleId] = useState('');
  const [service, setService] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const members = useQuery({ queryKey: ['roster', g.id, 'members'], queryFn: () => fetchAll<MemberDto>('/members', { bacentaId: g.id }), enabled: open, staleTime: 60_000 });
  const pool = (members.data ?? []).filter((m) => !roleId || m.bacentas.some((b) => b.id === g.id && b.roles.some((r) => r.id === roleId)));
  const save = useMutation({
    mutationFn: () => api(`/groups/${g.id}/roster`, { method: 'POST', body: { date, roleId: roleId || null, service: service || null, memberIds: picked } }),
    onSuccess: () => (toast.success('Added to the rota'), setPicked([]), onOpenChange(false), onSaved()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add to ${g.name}’s rota`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!date || !picked.length} onClick={() => save.mutate()}>
            Add {picked.length || ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="ro-date">
            <Input id="ro-date" type="date" min={localDate()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Service (optional)" htmlFor="ro-svc">
            <Input id="ro-svc" maxLength={60} placeholder="e.g. 1st service" value={service} onChange={(e) => setService(e.target.value)} />
          </Field>
        </div>
        {g.roles.length > 0 && (
          <Field label="Team" htmlFor="ro-role">
            <Select id="ro-role" value={roleId} onChange={(e) => (setRoleId(e.target.value), setPicked([]))}>
              <option value="">Any / general duty</option>
              {g.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {members.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : pool.length ? (
            pool.map((m) => (
              <Checkbox key={m.id} label={m.fullName} checked={picked.includes(m.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />
            ))
          ) : (
            <p className="text-sm text-muted">Nobody {roleId ? 'in that team' : 'in this bacenta'} yet.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
