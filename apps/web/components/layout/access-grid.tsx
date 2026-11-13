'use client';

import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/table';
import type { CategoryDto } from '@wcc/shared';

export interface GrantRow {
  categoryId: string;
  canView: boolean;
  canUpload: boolean;
  canManage: boolean;
}

/** Checkbox grid: one row per folder, View / Upload / Manage. */
export function AccessGrid({ categories, value, onChange }: { categories: CategoryDto[]; value: GrantRow[]; onChange: (v: GrantRow[]) => void }) {
  const get = (id: string) => value.find((g) => g.categoryId === id) ?? { categoryId: id, canView: true, canUpload: false, canManage: false };
  const set = (id: string, patch: Partial<GrantRow>) => {
    const next = { ...get(id), ...patch };
    if (next.canManage) next.canUpload = true;
    if (next.canUpload) next.canView = true;
    onChange([...value.filter((g) => g.categoryId !== id), next]);
  };
  return (
    <Table>
      <THead>
        <tr>
          <Th>Folder</Th>
          <Th className="text-center">View</Th>
          <Th className="text-center">Upload</Th>
          <Th className="text-center">Manage</Th>
        </tr>
      </THead>
      <TBody>
        {categories.map((c) => {
          const g = get(c.id);
          return (
            <Tr key={c.id}>
              <Td>{c.name}</Td>
              {(['canView', 'canUpload', 'canManage'] as const).map((k) => (
                <Td key={k} className="text-center">
                  <input type="checkbox" aria-label={`${k.slice(3)} ${c.name}`} className="h-4 w-4 accent-[var(--brand)]" checked={g[k]} onChange={(e) => set(c.id, { [k]: e.target.checked })} />
                </Td>
              ))}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
