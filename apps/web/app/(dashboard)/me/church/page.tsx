'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarCheck, Cake, ClipboardCheck, Pencil, ShieldCheck, Users } from 'lucide-react';
import { GROUP_TYPE_LABELS, type MyChurchDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EMAIL_PATTERN, Field, Input, PhoneInput } from '@/components/ui/form';
import { Card, EmptyState, PageHeader, PageLoader } from '@/components/ui/misc';
import { PastorCard } from '@/components/church/church-ui';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { formatDay, localDate } from '@/lib/membership';

export default function MyChurchPage() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'church'], queryFn: () => api<MyChurchDto>('/me/church') });
  const [editing, setEditing] = useState(false);
  if (q.isLoading || me.isLoading) return <PageLoader />;
  if (q.error) return <EmptyState title="Couldn’t load your church details">{errorMessage(q.error)}</EmptyState>;
  const d = q.data!;
  if (!d.member) return <EmptyState title="Your account isn’t linked to a member record yet">Ask your pastor or shepherd to link it (they can invite you from your member page).</EmptyState>;
  const m = d.member;

  return (
    <>
      <PageHeader
        title="My church"
        subtitle={[m.constituency?.name, m.basonta?.name].filter(Boolean).join(' · ') || 'Your groups, leaders and duties.'}
        actions={
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" /> My details
          </Button>
        }
      />
      {!me.data?.totpEnabled && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
          <ShieldCheck className="h-5 w-5 text-brand" />
          <span className="min-w-0 flex-1">Want extra security? Turn on two-step sign-in with an authenticator app (optional).</span>
          <Link href="/account?setup2fa=1">
            <Button size="sm" variant="outline">
              Set it up
            </Button>
          </Link>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="space-y-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4" /> My groups and leaders
          </h2>
          {d.leaders.length ? (
            d.leaders.map((l) => (
              <div key={l.group.id} className="space-y-2 border-t border-border pt-3 first:border-0 first:pt-0">
                <p className="text-sm">
                  <b>{l.group.name}</b> <span className="text-muted">· {GROUP_TYPE_LABELS[l.group.type]}</span>
                </p>
                {l.pastor && <PastorCard pastor={l.pastor} />}
                {l.shepherds.map((s) => (
                  <PastorCard key={s.id} pastor={s} />
                ))}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">You’re not in any group yet.</p>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="space-y-2 p-4" data-my-rota>
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarCheck className="h-4 w-4" /> My duties
            </h2>
            {d.roster.length ? (
              <ul className="divide-y divide-border text-sm">
                {d.roster.map((r) => (
                  <li key={r.id} className="py-1.5">
                    <b>{formatDay(r.date)}</b> <span className="text-muted">· {[r.role?.name, r.service].filter(Boolean).join(', ') || 'On duty'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">You’re not on any rota in the coming weeks.</p>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <Cake className="h-4 w-4" /> Birthdays coming up
            </h2>
            {d.birthdays.length ? (
              <ul className="divide-y divide-border text-sm">
                {d.birthdays.map((b) => (
                  <li key={b.id} className="py-1.5">
                    {b.fullName} <span className="text-muted">· {b.daysAway === 0 ? 'today' : b.daysAway === 1 ? 'tomorrow' : formatDay(b.date)} · {b.group}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None in the next two weeks.</p>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <ClipboardCheck className="h-4 w-4" /> My attendance
            </h2>
            {d.attendance.length ? (
              <ul className="divide-y divide-border text-sm">
                {d.attendance.map((a, i) => (
                  <li key={i} className="py-1.5">
                    {formatDay(a.date)} <span className="text-muted">· {a.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing recorded yet.</p>
            )}
          </Card>
        </div>
      </div>
      <DetailsDialog open={editing} onOpenChange={setEditing} d={d} onSaved={(x) => qc.setQueryData(['me', 'church'], x)} />
    </>
  );
}

function DetailsDialog({ open, onOpenChange, d, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; d: MyChurchDto; onSaved: (d: MyChurchDto) => void }) {
  const m = d.member!;
  const [f, setF] = useState({ phone: '', email: '', location: '', dateOfBirth: '' });
  useEffect(() => {
    if (open) setF({ phone: m.phone ?? '', email: m.email ?? '', location: m.location ?? '', dateOfBirth: m.dateOfBirth ?? '' });
  }, [open, m]);
  const save = useMutation({
    mutationFn: () => api<MyChurchDto>('/me/member', { method: 'PATCH', body: { phone: f.phone || null, email: f.email || null, location: f.location || null, dateOfBirth: f.dateOfBirth || null } }),
    onSuccess: (x) => (onSaved(x), onOpenChange(false), toast.success('Saved')),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="My details"
      description="Keep your contact details up to date so your leaders can reach you."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Phone" htmlFor="my-phone">
          <PhoneInput id="my-phone" value={f.phone} onValueChange={(phone) => setF({ ...f, phone })} />
        </Field>
        <Field label="Email (on your member record)" htmlFor="my-email">
          <Input id="my-email" type="email" pattern={EMAIL_PATTERN} maxLength={160} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Where you stay" htmlFor="my-loc">
          <Input id="my-loc" maxLength={160} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label="Date of birth" htmlFor="my-dob">
          <Input id="my-dob" type="date" max={localDate()} value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
