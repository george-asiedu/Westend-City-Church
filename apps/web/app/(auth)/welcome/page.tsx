'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';

/** Public visitor card: first-timers scan the QR code at church and fill this in. */
export default function WelcomePage() {
  const [f, setF] = useState({ fullName: '', phone: '', location: '', howHeard: '', prayerRequest: '', wantsToJoin: false, consent: false, website: '' });
  const send = useMutation({ mutationFn: () => api('/public/visitor-card', { method: 'POST', body: { ...f, phone: f.phone || null, location: f.location || null, howHeard: f.howHeard || null, prayerRequest: f.prayerRequest || null } }) });

  if (send.isSuccess)
    return (
      <Card className="space-y-3 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <h1 className="text-lg font-semibold">Thank you, {f.fullName.split(' ')[0]}!</h1>
        <p className="text-sm text-muted">We’re so glad you came. Someone from the church may reach out to welcome you this week.</p>
      </Card>
    );

  return (
    <Card className="p-5">
      <h1 className="mb-1 text-lg font-semibold">Welcome to church!</h1>
      <p className="mb-4 text-sm text-muted">Is this your first time? We’d love to know you.</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <Field label="Your name" htmlFor="v-name">
          <Input id="v-name" required minLength={2} maxLength={100} autoComplete="name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <Field label="Phone (WhatsApp)" htmlFor="v-phone">
          <Input id="v-phone" type="tel" inputMode="tel" maxLength={30} autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Where do you stay?" htmlFor="v-loc">
          <Input id="v-loc" maxLength={120} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <Field label="How did you hear about us?" htmlFor="v-how">
          <Select id="v-how" value={f.howHeard} onChange={(e) => setF({ ...f, howHeard: e.target.value })}>
            <option value="">Choose…</option>
            {['A friend or family member invited me', 'Social media', 'I passed by', 'Radio or TV', 'Outreach or crusade', 'Other'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label="Anything we can pray with you about? (optional)" htmlFor="v-pray">
          <Textarea id="v-pray" rows={3} maxLength={1000} value={f.prayerRequest} onChange={(e) => setF({ ...f, prayerRequest: e.target.value })} />
        </Field>
        {/* Honeypot: hidden from people, bots fill it in. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-0 w-0 opacity-0" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
        <Checkbox label="I’d like to become a member" checked={f.wantsToJoin} onChange={(e) => setF({ ...f, wantsToJoin: e.target.checked })} />
        <Checkbox
          label="The church may keep these details and contact me."
          checked={f.consent}
          required
          onChange={(e) => setF({ ...f, consent: e.target.checked })}
        />
        {send.error && <p className="text-sm text-danger">{errorMessage(send.error)}</p>}
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!f.consent || f.fullName.trim().length < 2}>
          Send
        </Button>
      </form>
    </Card>
  );
}
