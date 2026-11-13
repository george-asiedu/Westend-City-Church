import { cn } from '@/lib/utils';

/**
 * One table style for the whole app: tinted header, alternating row shading, hover,
 * rounded frame that scrolls sideways inside itself (never the page).
 */
export function Table({ className, children, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className={cn('w-full min-w-max border-collapse text-left text-sm', className)} {...p}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-2 text-xs uppercase tracking-wide text-muted', className)} {...p} />;
}

export function TBody({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&>tr:nth-child(even)]:bg-surface-2/50 [&>tr]:border-t [&>tr]:border-border', className)} {...p} />;
}

export function Tr({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-brand/5', className)} {...p} />;
}

export function Th({ className, numeric, ...p }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope="col" className={cn('whitespace-nowrap px-4 py-2.5 font-semibold', numeric && 'text-right', className)} {...p} />;
}

export function Td({ className, numeric, ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn('px-4 py-2.5 align-middle', numeric && 'text-right tabular-nums', className)} {...p} />;
}
