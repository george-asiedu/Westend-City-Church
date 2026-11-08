'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import type { CategoryDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/form';
import { Badge, Card, PageHeader, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useCategories } from '@/lib/queries';

function Row({ c, onMove, first, last }: { c: CategoryDto; onMove: (dir: -1 | 1) => void; first: boolean; last: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? '');
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/categories/${c.id}`, { method: 'PATCH', body }),
    onSuccess: () => (toast.success('Saved'), qc.invalidateQueries({ queryKey: qk.categories })),
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
      </div>
    </Card>
  );
}

export default function CategoriesAdminPage() {
  const categories = useCategories();
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
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title="Folders" subtitle="Rename, reorder, describe or hide folders. Folders are never deleted." />
      <div className="space-y-3">
        {list.map((c, i) => (
          <Row key={c.id} c={c} first={i === 0} last={i === list.length - 1} onMove={(d) => move(i, d)} />
        ))}
      </div>
    </>
  );
}
