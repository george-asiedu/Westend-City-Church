'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Card, PageLoader } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { formatDay } from '@/lib/membership';

interface Info {
  service: { serviceType: string; title: string | null; date: string };
  me: { id: string; fullName: string; checkedIn: boolean; household: Array<{ id: string; fullName: string; checkedIn: boolean }> } | null;
}
interface Done {
  name: string;
  household: string[];
  companions: number;
  householdChoices?: Array<{ id: string; name: string }>;
}
const RELATIONS = ['Child', 'Relative', 'Friend', 'Other'];

const signedIn = () => typeof document !== 'undefined' && /(?:^|; )wcc_csrf=/.test(document.cookie);

/** Members scan the service's QR code and check themselves (and the people with them) in. */
export default function CheckinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [auth, setAuth] = useState<boolean | null>(null);
  useEffect(() => setAuth(signedIn()), []);
  const base = auth ? `/checkin/${encodeURIComponent(code)}` : `/public/checkin/${encodeURIComponent(code)}`;
  const info = useQuery({ queryKey: ['checkin', code, auth], queryFn: () => api<Info>(base, { anonymous: !auth }), enabled: auth !== null, retry: false });
  const [phone, setPhone] = useState('');
  const [household, setHousehold] = useState<string[]>([]);
  const [others, setOthers] = useState<Array<{ fullName: string; relation: string }>>([]);
  useEffect(() => {
    if (info.data?.me) setHousehold(info.data.me.household.map((h) => h.id));
  }, [info.data]);
  const send = useMutation({
    mutationFn: () =>
      api<Done>(base, {
        method: 'POST',
        anonymous: !auth,
        body: { phone: info.data?.me ? undefined : phone, householdIds: household, companions: others.filter((o) => o.fullName.trim()) },
      }),
  });

  if (auth === null || info.isLoading) return <PageLoader />;
  if (info.error)
    return (
      <Card className="space-y-2 p-6 text-center">
        <p className="font-semibold">Check-in isn’t open</p>
        <p className="text-sm text-muted">{errorMessage(info.error)}</p>
      </Card>
    );
  const d = info.data!;
  const service = `${d.service.serviceType}${d.service.title ? ` (${d.service.title})` : ''}`;

  if (send.isSuccess) {
    const r = send.data;
    return (
      <Card className="space-y-3 p-6 text-center" data-checked-in>
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <h1 className="text-xl font-semibold">Welcome, {r.name}!</h1>
        <p className="text-sm">
          You’re checked in for {service}
          {r.household.length ? `, with ${r.household.join(', ')}` : ''}
          {r.companions ? ` and ${r.companions} ${r.companions === 1 ? 'person' : 'people'} with you` : ''}.
        </p>
        {!!r.householdChoices?.length && (
          <p className="text-xs text-muted">Next time you can also tick {r.householdChoices.map((h) => h.name).join(', ')}.</p>
        )}
        {!auth && (
          <p className="text-xs text-muted">
            Have the app?{' '}
            <Link className="text-brand hover:underline" href={`/login?next=${encodeURIComponent(`/checkin/${code}`)}`}>
              Sign in
            </Link>{' '}
            and next time it’s one tap.
          </p>
        )}
      </Card>
    );
  }

  const me = d.me;
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h1 className="text-lg font-semibold">Check in</h1>
        <p className="text-sm text-muted">
          {service} · {formatDay(d.service.date)}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        {me ? (
          <p className="rounded-lg bg-surface-2 p-3 text-sm">
            Checking in as <b>{me.fullName}</b>
            {me.checkedIn && <span className="block text-xs text-success">You’re already checked in. You can still add people with you.</span>}
          </p>
        ) : (
          <>
            <Field label="Your phone number" htmlFor="ci-phone" hint="The number the church has for you">
              <Input id="ci-phone" type="tel" inputMode="tel" required maxLength={30} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            {auth === false && (
              <p className="text-xs text-muted">
                Or{' '}
                <Link className="text-brand hover:underline" href={`/login?next=${encodeURIComponent(`/checkin/${code}`)}`}>
                  sign in to the app
                </Link>{' '}
                for one-tap check-in.
              </p>
            )}
          </>
        )}

        {!!me?.household.length && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Checking in with you</p>
            {me.household.map((h) => (
              <Checkbox
                key={h.id}
                label={`${h.fullName}${h.checkedIn ? ' (already in)' : ''}`}
                checked={household.includes(h.id)}
                onChange={(e) => setHousehold(e.target.checked ? [...household, h.id] : household.filter((x) => x !== h.id))}
              />
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Anyone else with you?</p>
          <p className="text-xs text-muted">Children, relatives or friends who aren’t checking in themselves.</p>
          {others.map((o, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label="Their name" placeholder="Their name" maxLength={100} value={o.fullName} onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, fullName: e.target.value } : x)))} />
              <Select aria-label="Who they are" className="w-32 shrink-0" value={o.relation} onChange={(e) => setOthers(others.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)))}>
                {RELATIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
              <button type="button" className="shrink-0 rounded-lg p-2 text-muted hover:text-danger" aria-label="Remove" onClick={() => setOthers(others.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {others.length < 15 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOthers([...others, { fullName: '', relation: 'Child' }])}>
              <Plus className="h-4 w-4" /> Add someone
            </Button>
          )}
        </div>

        {send.error && <p className="text-sm text-danger">{errorMessage(send.error)}</p>}
        <Button type="submit" size="lg" className="w-full" loading={send.isPending}>
          I’m here
        </Button>
      </form>
    </Card>
  );
}
