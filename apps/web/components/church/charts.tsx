'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Small, dependency-free charts. Colours come from validated tokens (--viz-1..3) with a
 * light/dark step each; every chart prints its values beside the marks (identity is never
 * colour alone) and has a hover/tap readout.
 */

export const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)'] as const;

// ---------------------------------------------------------------- column trend (single series)

export interface TrendPoint {
  key: string;
  label: string;
  /** shown in the readout, e.g. "Sun 9 Nov · Sunday service" */
  detail: string;
  value: number;
}

export function ColumnTrend({ data, unit = 'present', height = 160 }: { data: TrendPoint[]; unit?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="text-sm text-muted">Nothing recorded in this period.</p>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const h = hover !== null ? data[hover] : data[data.length - 1];
  return (
    <div>
      <p className="mb-2 min-h-5 text-sm text-muted" aria-live="polite">
        <span className="font-medium text-fg">{h!.value}</span> {unit} · {h!.detail}
      </p>
      <div className="relative" style={{ height }}>
        {/* recessive gridlines at 50% / 100% */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
        <span className="absolute -top-2 right-0 bg-surface pl-1 text-[10px] text-muted">{max}</span>
        <div className="absolute inset-0 flex items-end justify-around gap-[2px] border-b border-border">
          {data.map((d, i) => (
            <button
              key={d.key}
              type="button"
              className="flex h-full min-w-0 max-w-14 flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setHover(i)}
              aria-label={`${d.detail}: ${d.value} ${unit}`}
            >
              <span
                className={cn('w-full max-w-10 rounded-t-[4px] transition-opacity', hover !== null && hover !== i && 'opacity-40')}
                style={{ height: `${Math.max(1.5, (d.value / max) * 100)}%`, background: 'var(--viz-1)' }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{data[0]!.label}</span>
        {data.length > 1 && <span>{data[data.length - 1]!.label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- doughnut (<= 3 parts)

export interface Slice {
  label: string;
  value: number;
}

/**
 * A doughnut for a whole split into at most three parts, with the total in the middle
 * and a legend that lists each part's value and share. More parts → use RankedBars.
 */
export function Doughnut({ title, slices, centerLabel = 'total', size = 132 }: { title: string; slices: Slice[]; centerLabel?: string; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const parts = slices.slice(0, 3);
  const total = parts.reduce((a, s) => a + s.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && parts.filter((p) => p.value > 0).length > 1 ? 2.2 : 0; // surface gap between segments
  let offset = 0;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const h = hover !== null ? parts[hover] : null;
  return (
    <figure className="flex min-w-0 flex-col items-center gap-3 sm:flex-row sm:items-center">
      <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0 -rotate-90" role="img" aria-label={`${title}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--viz-track)" strokeWidth="13" />
        {total > 0 &&
          parts.map((p, i) => {
            const len = (p.value / total) * c;
            const seg = Math.max(0, len - gap);
            const el = (
              <circle
                key={p.label}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={VIZ[i]}
                strokeWidth={hover === i ? 15 : 13}
                strokeDasharray={`${seg} ${c - seg}`}
                strokeDashoffset={-offset}
                className={cn('cursor-pointer transition-[stroke-width,opacity]', hover !== null && hover !== i && 'opacity-40')}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(hover === i ? null : i)}
              />
            );
            offset += len;
            return p.value > 0 ? el : null;
          })}
        <g transform="rotate(90 50 50)">
          <text x="50" y="49" textAnchor="middle" className="fill-[var(--fg)] text-[17px] font-semibold tabular-nums">
            {h ? h.value : total}
          </text>
          <text x="50" y="62" textAnchor="middle" className="fill-[var(--muted)] text-[8px]">
            {h ? `${pct(h.value)}%` : centerLabel}
          </text>
        </g>
      </svg>
      <figcaption className="min-w-0 space-y-1.5 text-sm">
        <h3 className="font-medium">{title}</h3>
        <ul className="space-y-1">
          {parts.map((p, i) => (
            <li
              key={p.label}
              className={cn('flex items-center gap-2', hover !== null && hover !== i && 'opacity-60')}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: VIZ[i] }} aria-hidden />
              <span className="min-w-0 text-muted">{p.label}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums">{p.value}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(p.value)}%</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- ranked bars (one hue)

export function RankedBars({ rows, unit, max: maxRows = 10, empty = 'Nothing to show yet.' }: { rows: Array<{ key: string; label: string; value: number; href?: string }>; unit?: string; max?: number; empty?: string }) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, maxRows);
  const rest = sorted.slice(maxRows);
  const all = rest.length ? [...shown, { key: 'other', label: `Other (${rest.length})`, value: rest.reduce((a, r) => a + r.value, 0) }] : shown;
  const max = Math.max(1, ...all.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {all.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
          <span className="truncate text-muted" title={r.label}>
            {r.label}
          </span>
          <span className="h-2.5 rounded-r-[4px] bg-[var(--viz-track)]">
            <span className="block h-full rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: 'var(--viz-1)' }} />
          </span>
          <span className="tabular-nums font-medium">
            {r.value}
            {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
