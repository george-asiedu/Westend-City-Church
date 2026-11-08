import Link from 'next/link';
import { Film, Image as ImageIcon, Lock } from 'lucide-react';
import type { EventDto } from '@wcc/shared';
import { Badge } from '@/components/ui/misc';
import { eventDateRange } from '@/lib/utils';

export function EventCard({ event, showCategory }: { event: EventDto; showCategory?: boolean }) {
  return (
    <Link href={`/e/${event.id}`} className="group block overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
      <div className="relative aspect-[4/3] bg-surface-2">
        {event.coverThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverThumbUrl} alt={`Cover of ${event.title}`} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
        {event.status === 'DRAFT' && (
          <Badge tone="warning" className="absolute left-2 top-2">
            <Lock className="mr-1 h-3 w-3" /> Draft
          </Badge>
        )}
      </div>
      <div className="space-y-1 p-3">
        {showCategory && <p className="truncate text-xs text-muted">{event.category.name}</p>}
        <p className="line-clamp-2 text-sm font-medium leading-snug">{event.title}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{eventDateRange(event.eventDate, event.endDate)}</span>
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="h-3 w-3" /> {event.photoCount}
          </span>
          {event.videoCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Film className="h-3 w-3" /> {event.videoCount}
            </span>
          )}
          {event.programType && <Badge>{event.programType}</Badge>}
        </div>
      </div>
    </Link>
  );
}

export function EventGrid({ events, showCategory }: { events: EventDto[]; showCategory?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1800px]:grid-cols-6">
      {events.map((e) => (
        <EventCard key={e.id} event={e} showCategory={showCategory} />
      ))}
    </div>
  );
}
