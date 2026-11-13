'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface PagedList {
  page: number;
  offset: number;
  items: unknown[];
  total?: number;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
  isFetching?: boolean;
}

/**
 * Previous / Next for cursor-paginated lists ("11–20 of 84 · Page 2"). Brings the list
 * back into view after changing page so you don't have to scroll.
 */
export function Pager({ list, className }: { list: PagedList; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  if (!list.hasPrev && !list.hasNext) return null;
  const from = list.offset + 1;
  const to = list.offset + list.items.length;
  const go = (fn: () => void) => {
    fn();
    // Scroll to the top of the list this pager belongs to (its card), not the page.
    const card = ref.current?.closest('[data-pager-scope]') ?? ref.current?.parentElement;
    requestAnimationFrame(() => card?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  return (
    <div ref={ref} className={cn('flex items-center justify-between gap-2 px-1 py-3 text-sm', className)}>
      <Button size="sm" variant="outline" disabled={!list.hasPrev || list.isFetching} onClick={() => go(list.prev)} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Previous</span>
      </Button>
      <span className="text-center text-muted tabular-nums" aria-live="polite">
        {from}–{to}
        {list.total !== undefined ? ` of ${list.total}` : ''}
        <span className="hidden sm:inline"> · Page {list.page}</span>
      </span>
      <Button size="sm" variant="outline" disabled={!list.hasNext || list.isFetching} onClick={() => go(list.next)} aria-label="Next page">
        <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
