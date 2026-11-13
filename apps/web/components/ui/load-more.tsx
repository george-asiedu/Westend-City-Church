'use client';

import { Button } from './button';

/** "Load more" for cursor-paginated lists (10 at a time). */
export function LoadMore({ hasMore, loading, onClick, shown, total }: { hasMore: boolean; loading: boolean; onClick: () => void; shown: number; total?: number }) {
  if (!hasMore && (total === undefined || shown >= total)) return total !== undefined && total > 10 ? <p className="py-3 text-center text-xs text-muted">All {total} shown</p> : null;
  return (
    <div className="flex flex-col items-center gap-1 py-3">
      <Button variant="outline" size="sm" loading={loading} onClick={onClick} disabled={!hasMore}>
        Load more
      </Button>
      {total !== undefined && (
        <span className="text-xs text-muted">
          Showing {shown} of {total}
        </span>
      )}
    </div>
  );
}
