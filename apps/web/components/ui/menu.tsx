'use client';

import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = 'end' }: { children: React.ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-lg">
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ children, onSelect, danger, disabled }: { children: React.ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2',
        danger && 'text-danger',
      )}
    >
      {children}
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
