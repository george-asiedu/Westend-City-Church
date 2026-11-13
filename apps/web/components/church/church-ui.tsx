'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Phone, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  CHURCH_ROLE_SUGGESTIONS,
  GROUP_TYPE_HELP,
  GROUP_TYPE_LABELS,
  ROLE_LABELS,
  ROLE_PERMISSION_LABELS,
  type GroupDto,
  type MemberDto,
  type PastorDto,
  type Role,
  type RolePermissionKey,
} from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { mk, useGroups, usePastors, type MemberDetail } from '@/lib/membership';
import { cn } from '@/lib/utils';

/** Attendance · Members · Groups */
export function ChurchTabs() {
  const pathname = usePathname();
  const me = useMe();
  const tabs = [
    { href: '/church/attendance', label: 'Attendance' },
    { href: '/church/members', label: 'Members' },
    { href: '/church/groups', label: 'Groups' },
    ...(me.data?.permissions.canManageMembership ? [{ href: '/church/leaders', label: 'Pastors & shepherds' }] : []),
  ];
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="Church">
      {tabs.map((t) => {
        const on = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', on ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-fg')}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Pastor name, title and contact links. */
export function PastorCard({ pastor, className }: { pastor: PastorDto | null; className?: string }) {
  if (!pastor)
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted', className)}>
        <UserRound className="h-4 w-4" /> No pastor assigned
      </div>
    );
  return (
    <div className={cn('min-w-0 space-y-1 text-sm', className)}>
      <p className="flex items-center gap-2 font-medium">
        <UserRound className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate">
          {pastor.title ? `${pastor.title} ` : ''}
          {pastor.fullName}
        </span>
      </p>
      {pastor.phone && (
        <a href={`tel:${pastor.phone}`} className="flex items-center gap-2 text-brand hover:underline">
          <Phone className="h-4 w-4 shrink-0" /> {pastor.phone}
        </a>
      )}
      <a href={`mailto:${pastor.email}`} className="flex min-w-0 items-center gap-2 text-brand hover:underline">
        <Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{pastor.email}</span>
      </a>
    </div>
  );
}

// ---------------------------------------------------------------- group form

type GType = 'CONSTITUENCY' | 'BASONTA' | 'BACENTA';

/** Which kinds of group this user may create, and under which constituencies (for basontas). */
export function useCreatableTypes() {
  const me = useMe();
  const constituencies = useGroups('CONSTITUENCY');
  const p = me.data?.permissions;
  const admin = !!p?.canManageMembership;
  const pastor = me.data?.role === 'PASTOR';
  const ledConstituencies = (constituencies.data ?? []).filter((c) => admin || c.pastor?.id === me.data?.id);
  const types: GType[] = [...(admin ? (['CONSTITUENCY'] as const) : []), ...(ledConstituencies.length ? (['BASONTA'] as const) : []), ...(admin || pastor ? (['BACENTA'] as const) : [])];
  return { types, ledConstituencies, admin };
}

export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  defaultType = 'CONSTITUENCY',
  defaultParentId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  group?: GroupDto | null;
  defaultType?: GType;
  defaultParentId?: string;
  onSaved?: (g: GroupDto) => void;
}) {
  const qc = useQueryClient();
  const { types, ledConstituencies, admin } = useCreatableTypes();
  const pastors = usePastors(open && admin);
  const [f, setF] = useState({ type: defaultType as GType, name: '', description: '', meetingDay: '', meetingPlace: '', pastorId: '', parentId: '' });
  useEffect(() => {
    if (!open) return;
    const type = group?.type ?? (types.includes(defaultType) ? defaultType : (types[0] ?? defaultType));
    setF({
      type,
      name: group?.name ?? '',
      description: group?.description ?? '',
      meetingDay: group?.meetingDay ?? '',
      meetingPlace: group?.meetingPlace ?? '',
      pastorId: group?.pastor?.id ?? '',
      parentId: group?.parent?.id ?? defaultParentId ?? ledConstituencies[0]?.id ?? '',
    });
  }, [open, group, defaultType]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        description: f.description || null,
        meetingDay: f.meetingDay || null,
        meetingPlace: f.meetingPlace || null,
        ...(admin ? { pastorId: f.pastorId || null } : {}),
        ...(f.type === 'BASONTA' && f.parentId ? { parentId: f.parentId } : {}),
      };
      return group ? api<GroupDto>(`/groups/${group.id}`, { method: 'PATCH', body }) : api<GroupDto>('/groups', { method: 'POST', body: { ...body, type: f.type } });
    },
    onSuccess: (g) => {
      toast.success(group ? `${g.name} saved` : `${GROUP_TYPE_LABELS[g.type]} “${g.name}” created`);
      void qc.invalidateQueries({ queryKey: ['groups'] });
      void qc.invalidateQueries({ queryKey: ['group'] });
      onOpenChange(false);
      onSaved?.(g);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pastorLabel = f.type === 'CONSTITUENCY' ? 'Head pastor' : 'Pastor';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={group ? `Edit ${group.name}` : 'New group'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={f.name.trim().length < 2 || (f.type === 'BASONTA' && !f.parentId)} onClick={() => save.mutate()}>
            {group ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!group && (
          <Field label="Kind of group" htmlFor="g-type" hint={GROUP_TYPE_HELP[f.type]}>
            <Select id="g-type" value={f.type} onChange={set('type')}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {GROUP_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {f.type === 'BASONTA' && (
          <Field label="Under constituency" htmlFor="g-parent">
            <Select id="g-parent" value={f.parentId} onChange={set('parentId')}>
              {!f.parentId && <option value="">Choose…</option>}
              {(group?.parent && !ledConstituencies.some((c) => c.id === group.parent!.id) ? [{ id: group.parent.id, name: group.parent.name }] : []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {ledConstituencies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Name" htmlFor="g-name">
          <Input id="g-name" required minLength={2} maxLength={80} value={f.name} onChange={set('name')} autoFocus placeholder={f.type === 'BACENTA' ? 'e.g. Media, Choir, Ushers' : undefined} />
        </Field>
        {admin ? (
          <Field label={pastorLabel} htmlFor="g-pastor" hint="Pastors and Super Admins can lead groups.">
            <Select id="g-pastor" value={f.pastorId} onChange={set('pastorId')}>
              <option value="">No {pastorLabel.toLowerCase()} yet</option>
              {pastors.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          !group && <p className="text-sm text-muted">{f.type === 'BASONTA' ? 'As head pastor of the constituency you can manage this basonta. A Super Admin can assign it its own pastor.' : 'You will lead this group.'}</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Meeting day" htmlFor="g-day">
            <Input id="g-day" maxLength={40} placeholder="e.g. Wednesdays 6pm" value={f.meetingDay} onChange={set('meetingDay')} />
          </Field>
          <Field label="Meeting place" htmlFor="g-place">
            <Input id="g-place" maxLength={160} value={f.meetingPlace} onChange={set('meetingPlace')} />
          </Field>
        </div>
        <Field label="Description" htmlFor="g-desc">
          <Textarea id="g-desc" maxLength={500} value={f.description} onChange={set('description')} className="min-h-16" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- member form

const emptyMember = {
  fullName: '',
  phone: '',
  email: '',
  gender: '',
  dateOfBirth: '',
  location: '',
  churchRole: 'Member',
  constituencyId: '',
  basontaId: '',
  /** bacenta id → team role ids */
  bacentas: {} as Record<string, string[]>,
  joinedOn: '',
  notes: '',
  isActive: true,
};

export function MemberFormDialog({
  open,
  onOpenChange,
  member,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  member?: MemberDto | null;
  defaults?: { constituencyId?: string; basontaId?: string; bacentaIds?: string[]; fullName?: string; phone?: string; fromGuestId?: string; title?: string };
  onSaved?: (m: MemberDetail) => void;
}) {
  const qc = useQueryClient();
  const constituencies = useGroups('CONSTITUENCY');
  const basontas = useGroups('BASONTA');
  const bacentas = useGroups('BACENTA');
  const [f, setF] = useState(emptyMember);
  useEffect(() => {
    if (!open) return;
    if (member) {
      setF({
        fullName: member.fullName,
        phone: member.phone ?? '',
        email: member.email ?? '',
        gender: member.gender ?? '',
        dateOfBirth: member.dateOfBirth ?? '',
        location: member.location ?? '',
        churchRole: member.churchRole,
        constituencyId: member.constituency?.id ?? '',
        basontaId: member.basonta?.id ?? '',
        bacentas: Object.fromEntries(member.bacentas.map((b) => [b.id, b.roles.map((r) => r.id)])),
        joinedOn: member.joinedOn ?? '',
        notes: member.notes ?? '',
        isActive: member.isActive,
      });
    } else {
      const basonta = defaults?.basontaId ? basontas.data?.find((b) => b.id === defaults.basontaId) : undefined;
      setF({
        ...emptyMember,
        fullName: defaults?.fullName ?? '',
        phone: defaults?.phone ?? '',
        churchRole: defaults?.fromGuestId ? 'New convert' : 'Member',
        constituencyId: defaults?.constituencyId ?? basonta?.parent?.id ?? '',
        basontaId: defaults?.basontaId ?? '',
        bacentas: Object.fromEntries((defaults?.bacentaIds ?? []).map((id) => [id, []])),
      });
    }
  }, [open, member, defaults]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  // Basontas belong to a constituency: only offer the ones under the chosen constituency.
  const basontaOptions = (basontas.data ?? []).filter((b) => !f.constituencyId || b.parent?.id === f.constituencyId);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        fullName: f.fullName.trim(),
        phone: f.phone || null,
        email: f.email || null,
        gender: f.gender || null,
        dateOfBirth: f.dateOfBirth || null,
        location: f.location || null,
        churchRole: f.churchRole,
        constituencyId: f.constituencyId || null,
        basontaId: f.basontaId || null,
        bacentas: Object.entries(f.bacentas).map(([groupId, roleIds]) => ({ groupId, roleIds })),
        joinedOn: f.joinedOn || null,
        notes: f.notes || null,
        isActive: f.isActive,
      };
      return member
        ? api<MemberDetail>(`/members/${member.id}`, { method: 'PATCH', body })
        : api<MemberDetail>('/members', { method: 'POST', body: { ...body, fromGuestId: defaults?.fromGuestId } });
    },
    onSuccess: (m) => {
      toast.success(member ? `${m.fullName} saved` : `${m.fullName} added`);
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: mk.member(m.id) });
      void qc.invalidateQueries({ queryKey: ['groups'] });
      void qc.invalidateQueries({ queryKey: ['group'] });
      void qc.invalidateQueries({ queryKey: ['attendance'] });
      onOpenChange(false);
      onSaved?.(m);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleBacenta = (id: string, on: boolean) =>
    setF((s) => {
      const b = { ...s.bacentas };
      if (on) b[id] = b[id] ?? [];
      else delete b[id];
      return { ...s, bacentas: b };
    });
  const toggleRole = (bid: string, rid: string) =>
    setF((s) => {
      const cur = s.bacentas[bid] ?? [];
      return { ...s, bacentas: { ...s.bacentas, [bid]: cur.includes(rid) ? cur.filter((x) => x !== rid) : [...cur, rid] } };
    });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={member ? `Edit ${member.fullName}` : (defaults?.title ?? 'Add member')}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={f.fullName.trim().length < 2} onClick={() => save.mutate()}>
            {member ? 'Save' : 'Add member'}
          </Button>
        </>
      }
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Full name" htmlFor="m-name">
          <Input id="m-name" required minLength={2} maxLength={120} autoComplete="off" value={f.fullName} onChange={set('fullName')} autoFocus />
        </Field>
        <Field label="Role in church" htmlFor="m-role" hint="Change this when they become a shepherd, pastor, leader…">
          <Input id="m-role" list="church-roles" maxLength={60} value={f.churchRole} onChange={set('churchRole')} />
          <datalist id="church-roles">
            {CHURCH_ROLE_SUGGESTIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field label="Phone" htmlFor="m-phone">
          <Input id="m-phone" type="tel" inputMode="tel" maxLength={30} autoComplete="off" value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Where they stay" htmlFor="m-loc">
          <Input id="m-loc" maxLength={160} placeholder="Area / landmark" value={f.location} onChange={set('location')} />
        </Field>
        <Field label="Constituency" htmlFor="m-con">
          <Select
            id="m-con"
            value={f.constituencyId}
            onChange={(e) => {
              const c = e.target.value;
              setF((s) => ({ ...s, constituencyId: c, basontaId: basontas.data?.find((b) => b.id === s.basontaId)?.parent?.id === c ? s.basontaId : '' }));
            }}
          >
            <option value="">Not assigned</option>
            {constituencies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Basonta" htmlFor="m-bas" hint={f.constituencyId && !basontaOptions.length ? 'This constituency has no basontas yet.' : undefined}>
          <Select
            id="m-bas"
            value={f.basontaId}
            onChange={(e) => {
              const id = e.target.value;
              const parent = basontas.data?.find((b) => b.id === id)?.parent?.id;
              setF((s) => ({ ...s, basontaId: id, constituencyId: parent ?? s.constituencyId }));
            }}
          >
            <option value="">Not assigned</option>
            {basontaOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {!f.constituencyId && b.parent ? ` (${b.parent.name})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {!!bacentas.data?.length && (
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Bacentas (ministries) and their teams</legend>
            <div className="space-y-2">
              {bacentas.data.map((b) => {
                const on = f.bacentas[b.id] !== undefined;
                return (
                  <div key={b.id} className={cn('rounded-lg border p-2.5', on ? 'border-brand/40 bg-brand/5' : 'border-border')}>
                    <Checkbox label={<span className="font-medium">{b.name}</span>} checked={on} onChange={(e) => toggleBacenta(b.id, e.target.checked)} />
                    {on && b.roles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-6" role="group" aria-label={`${b.name} teams`}>
                        {b.roles.map((r) => {
                          const sel = f.bacentas[b.id]!.includes(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              aria-pressed={sel}
                              onClick={() => toggleRole(b.id, r.id)}
                              className={cn('rounded-full border px-2.5 py-1 text-xs', sel ? 'border-brand bg-brand text-white' : 'border-border text-muted hover:text-fg')}
                            >
                              {r.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {on && !b.roles.length && <p className="mt-1 pl-6 text-xs text-muted">No teams set up in {b.name} yet.</p>}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}
        <Field label="Gender" htmlFor="m-gender">
          <Select id="m-gender" value={f.gender} onChange={set('gender')}>
            <option value="">—</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </Select>
        </Field>
        <Field label="Email" htmlFor="m-email">
          <Input id="m-email" type="email" maxLength={254} autoComplete="off" value={f.email} onChange={set('email')} />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 [&>*]:min-w-0">
          <Field label="Date of birth" htmlFor="m-dob">
            <Input id="m-dob" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
          <Field label="Joined" htmlFor="m-joined">
            <Input id="m-joined" type="date" value={f.joinedOn} onChange={set('joinedOn')} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="m-notes">
            <Textarea id="m-notes" maxLength={1000} value={f.notes} onChange={set('notes')} className="min-h-16" />
          </Field>
        </div>
        {member && <Checkbox className="sm:col-span-2" label="Active member (shows on attendance sheets)" checked={f.isActive} onChange={(e) => setF((s) => ({ ...s, isActive: e.target.checked }))} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- role permissions

type RolePerms = { roles: Role[]; permissions: RolePermissionKey[]; grants: Array<{ role: Role; permission: RolePermissionKey }> };

/** Super Admin only: grant extra permissions to whole roles. */
export function RolePermissionsCard({ permissions, title, note }: { permissions: RolePermissionKey[]; title: string; note?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['role-permissions'], queryFn: () => api<RolePerms>('/role-permissions') });
  const save = useMutation({
    mutationFn: (grants: RolePerms['grants']) => api<RolePerms>('/role-permissions', { method: 'PUT', body: { grants } }),
    onSuccess: (r) => {
      qc.setQueryData(['role-permissions'], r);
      void qc.invalidateQueries({ queryKey: qk.me });
      toast.success('Permissions updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return null;
  const has = (role: Role, perm: RolePermissionKey) => q.data.grants.some((g) => g.role === role && g.permission === perm);
  const toggle = (role: Role, perm: RolePermissionKey, on: boolean) =>
    save.mutate(on ? [...q.data.grants, { role, permission: perm }] : q.data.grants.filter((g) => !(g.role === role && g.permission === perm)));
  return (
    <Card className="space-y-4 p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {note && <p className="text-sm text-muted">{note}</p>}
      </div>
      {permissions.map((perm) => (
        <div key={perm} className="space-y-2">
          <p className="text-sm font-medium">{ROLE_PERMISSION_LABELS[perm]}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label={ROLE_LABELS.SUPER_ADMIN} checked disabled />
            {q.data.roles.map((r) => (
              <Checkbox key={r} label={ROLE_LABELS[r]} checked={has(r, perm)} disabled={save.isPending} onChange={(e) => toggle(r, perm, e.target.checked)} />
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}
