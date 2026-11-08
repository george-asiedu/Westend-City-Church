'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

const EXPIRY = [
  { h: 24, label: '1 day' },
  { h: 72, label: '3 days' },
  { h: 168, label: '1 week' },
  { h: 720, label: '30 days' },
  { h: 2160, label: '90 days' },
];

/**
 * Time-limited share link for people outside the system (§19), e.g. sending a
 * family their christening photos. Optional password and download toggle.
 */
export function ShareDialog({
  open,
  onOpenChange,
  eventId,
  mediaIds,
  defaultTitle,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  eventId?: string;
  mediaIds?: string[];
  defaultTitle: string;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(defaultTitle);
  const [hours, setHours] = useState(168);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api<{ url: string }>('/shares', {
        method: 'POST',
        body: { eventId, mediaIds: eventId ? undefined : mediaIds, title, expiresInHours: hours, password: usePassword ? password : undefined, allowDownload },
      }),
    onSuccess: (r) => {
      setUrl(r.url);
      void qc.invalidateQueries({ queryKey: ['shares'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(() => (setUrl(null), setCopied(false), setPassword('')), 200);
  };

  const shareNative = async () => {
    if (!url) return;
    if (navigator.share) await navigator.share({ title, url }).catch(() => undefined);
  };

  return (
    <Dialog open={open} onOpenChange={close} title={url ? 'Link ready' : 'Share outside the church system'} description={url ? undefined : eventId ? 'Anyone with the link can view this event until it expires.' : `${mediaIds?.length ?? 0} selected items`}>
      {url ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">Copy it now: for security the full link is shown only once.{usePassword ? ' Send the password separately.' : ''}</p>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy link"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button variant="secondary" className="w-full justify-center" onClick={shareNative}>
              <Share2 className="h-4 w-4" /> Send via…
            </Button>
          )}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Title shown to visitors" htmlFor="share-title">
            <Input id="share-title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Expires after" htmlFor="share-exp">
            <Select id="share-exp" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {EXPIRY.map((x) => (
                <option key={x.h} value={x.h}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox label="Allow downloading originals" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
          <Checkbox label="Protect with a password" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
          {usePassword && (
            <Field label="Password" htmlFor="share-pw" hint="At least 6 characters.">
              <Input id="share-pw" type="text" autoComplete="off" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Button type="submit" className="w-full justify-center" loading={create.isPending}>
            Create link
          </Button>
        </form>
      )}
    </Dialog>
  );
}
