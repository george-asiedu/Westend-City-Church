'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS, ROLE_PERMISSION_LABELS, type CategoryDto, type RolePermissionKey, type Role } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Badge, Card, ConfirmButton, PageHeader, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useCategories, useMe } from '@/lib/queries';

function NewFolder() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [multiDay, setMultiDay] = useState(false);
  const create = useMutation({
    mutationFn: () => api<CategoryDto>('/categories', { method: 'POST', body: { name: name.trim(), description: description.trim() || null, allowsMultiDay: multiDay } }),
    onSuccess: () => {
      toast.success(`Folder “${name.trim()}” added`);
      setName('');
      setDescription('');
      setMultiDay(false);
      setOpen(false);
      void qc.invalidateQueries({ queryKey: qk.categories });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New folder
      </Button>
    );
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">New folder</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Name" htmlFor="nf-name">
          <Input id="nf-name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Description (optional)" className="min-h-16" />
        <Checkbox label="Events can span several days" checked={multiDay} onChange={(e) => setMultiDay(e.target.checked)} />
        <div className="flex gap-2">
          <Button type="submit" disabled={name.trim().length < 2} loading={create.isPending}>
            Add folder
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

type RolePerms = { roles: Role[]; permissions: RolePermissionKey[]; grants: Array<{ role: Role; permission: RolePermissionKey }> };

/** Super Admin only: let other roles add, edit and delete folders. */
function FolderPermissions() {
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
  const perm: RolePermissionKey = 'MANAGE_CATEGORIES';
  const has = (role: Role) => q.data.grants.some((g) => g.role === role && g.permission === perm);
  const toggle = (role: Role, on: boolean) =>
    save.mutate(on ? [...q.data.grants, { role, permission: perm }] : q.data.grants.filter((g) => !(g.role === role && g.permission === perm)));
  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="font-semibold">Who can manage folders</h2>
        <p className="text-sm text-muted">{ROLE_PERMISSION_LABELS[perm]}. Super Admins always can.</p>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox label={ROLE_LABELS.SUPER_ADMIN} checked disabled />
        {q.data.roles.map((r) => (
          <Checkbox key={r} label={ROLE_LABELS[r]} checked={has(r)} disabled={save.isPending} onChange={(e) => toggle(r, e.target.checked)} />
        ))}
      </div>
    </Card>
  );
}

function Row({ c, onMove, first, last }: { c: CategoryDto; onMove: (dir: -1 | 1) => void; first: boolean; last: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? '');
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/categories/${c.id}`, { method: 'PATCH', body }),
    onSuccess: (_, body) => (
      toast.success('isActive' in body ? (body.isActive ? `“${c.name}” is visible again` : `“${c.name}” is hidden`) : 'Folder saved'),
      qc.invalidateQueries({ queryKey: qk.categories })
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="flex gap-1 sm:flex-col">
        <Button size="icon" variant="ghost" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" disabled={last} onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          {!c.isActive && <Badge tone="warning">Hidden</Badge>}
        </div>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Description (optional)" className="min-h-16" />
        <p className="text-xs text-muted">
          /{c.slug} · {c.eventCount} events{c.allowsMultiDay ? ' · multi-day' : ''}
        </p>
      </div>
      <div className="flex gap-2 sm:flex-col">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate({ name, description: description || null })}>
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => save.mutate({ isActive: !c.isActive })}>
          {c.isActive ? 'Hide' : 'Show'}
        </Button>
        <ConfirmButton
          size="sm"
          variant="ghost"
          danger
          title={`Delete “${c.name}”?`}
          description={
            c.eventCount > 0
              ? 'This folder has events, so it can’t be deleted. Move or delete them first, or hide the folder instead.'
              : 'The folder will be removed for everyone. This cannot be undone.'
          }
          confirmLabel="Delete folder"
          onConfirm={async () => {
            try {
              await api(`/categories/${c.id}`, { method: 'DELETE' });
              toast.success(`Folder “${c.name}” deleted`);
              await qc.invalidateQueries({ queryKey: qk.categories });
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
          aria-label={`Delete ${c.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </ConfirmButton>
      </div>
    </Card>
  );
}

export default function CategoriesAdminPage() {
  const categories = useCategories();
  const me = useMe();
  const qc = useQueryClient();
  if (categories.isLoading) return <PageLoader />;
  const list = categories.data ?? [];
  const move = async (i: number, dir: -1 | 1) => {
    const a = list[i]!;
    const b = list[i + dir]!;
    try {
      await api(`/categories/${a.id}`, { method: 'PATCH', body: { sortOrder: b.sortOrder } });
      await api(`/categories/${b.id}`, { method: 'PATCH', body: { sortOrder: a.sortOrder } });
      await qc.invalidateQueries({ queryKey: qk.categories });
      toast.success('Order updated');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title="Folders" subtitle="Add, rename, reorder, describe, hide or delete folders. Only empty folders can be deleted." />
      <div className="space-y-3">
        {me.data?.permissions.canManageRolePermissions && <FolderPermissions />}
        <NewFolder />
        {list.map((c, i) => (
          <Row key={c.id} c={c} first={i === 0} last={i === list.length - 1} onMove={(d) => move(i, d)} />
        ))}
      </div>
    </>
  );
}
