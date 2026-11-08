'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, Check, Film, Loader2, Star } from 'lucide-react';
import type { MediaDto } from '@wcc/shared';
import { cn, formatDuration } from '@/lib/utils';

interface Row {
  items: Array<{ m: MediaDto; w: number }>;
  height: number;
}

const GAP = 4;

/** Justified rows: every row fills the width, keeping each item's aspect ratio. */
function layout(items: MediaDto[], width: number, target: number): Row[] {
  const rows: Row[] = [];
  let current: MediaDto[] = [];
  let ratioSum = 0;
  const ratio = (m: MediaDto) => (m.width && m.height ? Math.min(3, Math.max(0.4, m.width / m.height)) : 1.333);
  for (const m of items) {
    current.push(m);
    ratioSum += ratio(m);
    const h = (width - GAP * (current.length - 1)) / ratioSum;
    if (h <= target) {
      rows.push({ height: h, items: current.map((x) => ({ m: x, w: ratio(x) * h })) });
      current = [];
      ratioSum = 0;
    }
  }
  if (current.length) rows.push({ height: target, items: current.map((x) => ({ m: x, w: ratio(x) * target })) });
  return rows;
}

export function MediaGrid({
  items,
  selected,
  selecting,
  onToggle,
  onOpen,
  onEndReached,
}: {
  items: MediaDto[];
  selected: Set<string>;
  selecting: boolean;
  onToggle: (id: string, range?: boolean) => void;
  onOpen: (index: number) => void;
  onEndReached?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setOffset(el.getBoundingClientRect().top + window.scrollY);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const target = width < 640 ? 130 : width < 1024 ? 180 : 220;
  const rows = useMemo(() => (width ? layout(items, width, target) : []), [items, width, target]);
  const indexOf = useMemo(() => new Map(items.map((m, i) => [m.id, i])), [items]);

  const virtualizer = useWindowVirtualizer({ count: rows.length, estimateSize: (i) => (rows[i]?.height ?? target) + GAP, overscan: 6, scrollMargin: offset });
  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (last && last.index >= rows.length - 4) onEndReached?.();
  }, [virtualRows, rows.length, onEndReached]);

  // Long-press starts selection on touch screens.
  const press = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);

  return (
    <div ref={ref} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualRows.map((vr) => {
        const row = rows[vr.index]!;
        return (
          <div key={vr.key} className="absolute left-0 flex w-full" style={{ top: vr.start - virtualizer.options.scrollMargin, height: row.height, gap: GAP }}>
            {row.items.map(({ m, w }) => {
              const isSel = selected.has(m.id);
              const ready = m.status === 'READY';
              return (
                <div
                  key={m.id}
                  className={cn('group relative shrink-0 overflow-hidden rounded-md bg-surface-2', isSel && 'ring-4 ring-brand ring-inset')}
                  style={{ width: w, height: row.height }}
                  onPointerDown={(e) => {
                    if (e.pointerType !== 'touch') return;
                    press.current = { fired: false, t: setTimeout(() => (press.current && (press.current.fired = true), onToggle(m.id)), 450) };
                  }}
                  onPointerUp={() => press.current && clearTimeout(press.current.t)}
                  onPointerLeave={() => press.current && clearTimeout(press.current.t)}
                  onContextMenu={(e) => press.current && e.preventDefault()}
                >
                  <button
                    className="block h-full w-full"
                    aria-label={m.caption || m.originalFilename}
                    onClick={(e) => {
                      if (press.current?.fired) {
                        press.current = null;
                        return;
                      }
                      if (selecting || e.shiftKey) onToggle(m.id, e.shiftKey);
                      else if (ready) onOpen(indexOf.get(m.id) ?? 0);
                    }}
                  >
                    {ready && m.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbUrl} alt={m.caption || `Photo from this event`} loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
                    ) : m.status === 'FAILED' ? (
                      <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-danger">
                        <AlertTriangle className="h-5 w-5" /> Failed
                      </div>
                    ) : (
                      <div className="flex h-full animate-pulse flex-col items-center justify-center gap-1 text-xs text-muted">
                        <Loader2 className="h-5 w-5 animate-spin" /> {m.status === 'PENDING_UPLOAD' ? 'Uploading…' : 'Processing…'}
                      </div>
                    )}
                  </button>
                  {m.type === 'VIDEO' && ready && (
                    <span className="pointer-events-none absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                      <Film className="h-3 w-3" /> {formatDuration(m.durationSec)}
                    </span>
                  )}
                  {m.isFeatured && <Star className="pointer-events-none absolute left-1 top-1 h-4 w-4 fill-yellow-400 text-yellow-400 drop-shadow" />}
                  <button
                    onClick={() => onToggle(m.id)}
                    aria-label={isSel ? 'Deselect' : 'Select'}
                    aria-pressed={isSel}
                    className={cn(
                      'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow transition-opacity',
                      isSel ? 'bg-brand opacity-100' : 'bg-black/30 opacity-0 group-hover:opacity-100',
                      selecting && 'opacity-100',
                    )}
                  >
                    {isSel && <Check className="h-4 w-4 text-white" />}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
