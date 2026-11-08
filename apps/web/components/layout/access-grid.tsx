'use client';

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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-2 pr-2 font-medium">Folder</th>
            <th className="px-2 font-medium">View</th>
            <th className="px-2 font-medium">Upload</th>
            <th className="px-2 font-medium">Manage</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => {
            const g = get(c.id);
            return (
              <tr key={c.id} className="border-t border-border">
                <td className="py-2 pr-2">{c.name}</td>
                {(['canView', 'canUpload', 'canManage'] as const).map((k) => (
                  <td key={k} className="px-2">
                    <input type="checkbox" aria-label={`${k.slice(3)} ${c.name}`} className="h-4 w-4 accent-[var(--brand)]" checked={g[k]} onChange={(e) => set(c.id, { [k]: e.target.checked })} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
