'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { GUEST_INTENT_LABELS, type AttendanceSheetDto } from '@wcc/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

type GuestDraft = { fullName: string; phone: string; intent: 'VISIT' | 'JOINING' };

/** How many people a member brought (or "nobody"), and who they were. */
export function BroughtDialog({
  member,
  sheet,
  onClose,
  onSaved,
}: {
  member: { id: string; fullName: string } | null;
  sheet: AttendanceSheetDto;
  onClose: () => void;
  onSaved: (s: AttendanceSheetDto) => void;
}) {
  const [count, setCount] = useState(0);
  const [guests, setGuests] = useState<GuestDraft[]>([]);
  const converted = member
    ? sheet.guests.filter((g) => g.broughtBy?.id === member.id && g.convertedMember)
    : [];
  useEffect(() => {
    if (!member) return;
    const mine = sheet.guests.filter((g) => g.broughtBy?.id === member.id && !g.convertedMember);
    setGuests(mine.map((g) => ({ fullName: g.fullName ?? '', phone: g.phone ?? '', intent: g.intent })));
    setCount(sheet.brought[member.id] ?? mine.length + converted.length);
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep one row per person brought (names are optional).
  const setN = (n: number) => {
    const v = Math.max(0, Math.min(200, n));
    setCount(v);
    const rows = Math.max(0, v - converted.length);
    setGuests((g) =>
      g.length > rows
        ? g.slice(0, rows)
        : [
            ...g,
            ...Array.from({ length: rows - g.length }, () => ({
              fullName: '',
              phone: '',
              intent: 'VISIT' as const,
            })),
          ],
    );
  };
  const save = useMutation({
    mutationFn: () =>
      api<AttendanceSheetDto>(`/attendance/sessions/${sheet.session.id}/brought/${member!.id}`, {
        method: 'PUT',
        body: {
          broughtCount: count,
          guests: guests.map((g) => ({
            fullName: g.fullName.trim() || null,
            phone: g.phone.trim() || null,
            intent: g.intent,
          })),
        },
      }),
    onSuccess: (s) => {
      toast.success(count ? `${member!.fullName} brought ${count}` : `${member!.fullName} brought nobody`);
      onSaved(s);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (i: number, patch: Partial<GuestDraft>) =>
    setGuests((g) => g.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => !o && onClose()}
      title={member ? `Who did ${member.fullName} bring?` : ''}
      description="Count everyone they brought. Names and phone numbers are optional but help with follow-up."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={count === 0 ? 'primary' : 'outline'} size="sm" onClick={() => setN(0)}>
            Brought nobody
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              aria-label="One fewer"
              disabled={count <= converted.length}
              onClick={() => setN(count - 1)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xl font-semibold tabular-nums" aria-live="polite">
              {count}
            </span>
            <Button size="icon" variant="outline" aria-label="One more" onClick={() => setN(count + 1)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {converted.length > 0 && (
          <p className="text-xs text-muted">
            Includes {converted.map((g) => g.convertedMember!.fullName).join(', ')}, who{' '}
            {converted.length === 1 ? 'is' : 'are'} now a member.
          </p>
        )}
        {guests.map((g, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              <Input
                placeholder={`Person ${i + 1 + converted.length}: name (optional)`}
                maxLength={120}
                value={g.fullName}
                onChange={(e) => set(i, { fullName: e.target.value })}
              />
              <Input
                placeholder="Phone (optional)"
                type="tel"
                inputMode="tel"
                maxLength={30}
                value={g.phone}
                onChange={(e) => set(i, { phone: e.target.value })}
              />
            </div>
            <div
              className="inline-flex rounded-lg border border-border p-0.5 text-sm"
              role="radiogroup"
              aria-label="Visiting or joining"
            >
              {(['VISIT', 'JOINING'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={g.intent === k}
                  onClick={() => set(i, { intent: k })}
                  className={cn(
                    'rounded-md px-3 py-1',
                    g.intent === k ? 'bg-brand text-white' : 'text-muted hover:text-fg',
                  )}
                >
                  {GUEST_INTENT_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
