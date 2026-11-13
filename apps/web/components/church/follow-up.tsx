'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HeartHandshake } from 'lucide-react';
import type { PastorDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';

export function useAssignees(enabled = true) {
  return useQuery({ queryKey: ['follow-ups', 'assignees'], queryFn: () => api<PastorDto[]>('/follow-ups/assignees'), enabled, staleTime: 60_000 });
}

/** "Follow up" button + dialog, for a member or a new person. */
export function FollowUpButton({ memberId, guestId, name, defaultReason = '', size = 'sm' }: { memberId?: string; guestId?: string; name: string; defaultReason?: string; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(defaultReason);
  const [who, setWho] = useState('');
  const [due, setDue] = useState('');
  const people = useAssignees(open);
  const me = useMe();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api('/follow-ups', { method: 'POST', body: { memberId, guestId, reason, assignedToId: who || null, dueOn: due || null } }),
    onSuccess: () => (toast.success(`Follow-up added for ${name}`), setOpen(false), qc.invalidateQueries({ queryKey: ['follow-ups'] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Button size={size} variant="outline" onClick={() => (setReason(defaultReason), setOpen(true))}>
        <HeartHandshake className="h-4 w-4" /> Follow up
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Follow up ${name}`}
        description="Someone will be asked to call or visit, and it stays on the list until it’s done."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={reason.trim().length < 2} onClick={() => save.mutate()}>
              Add follow-up
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Why?" htmlFor="nf-reason">
            <Input id="nf-reason" maxLength={300} placeholder="e.g. Missed the last three Sundays" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Who should do it?" htmlFor="nf-who">
            <Select id="nf-who" value={who || me.data?.id || ''} onChange={(e) => setWho(e.target.value)}>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id === me.data?.id ? 'Me' : `${p.title ? `${p.title} ` : ''}${p.fullName}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="By (optional)" htmlFor="nf-due">
            <Input id="nf-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
