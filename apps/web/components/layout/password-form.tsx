'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, PasswordInput } from '@/components/ui/form';

/** New-password + confirm fields with the server's rules mirrored client-side. */
export function NewPasswordFields({ onChange }: { onChange: (password: string | null) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const tooShort = a.length > 0 && a.length < 12;
  const mismatch = b.length > 0 && a !== b;
  const update = (x: string, y: string) => onChange(x.length >= 12 && x === y ? x : null);
  return (
    <>
      <Field label="New password" htmlFor="pw" error={tooShort ? 'Use at least 12 characters' : undefined} hint="12+ characters. A short sentence is easy to remember and hard to guess.">
        <PasswordInput id="pw" autoComplete="new-password" value={a} onChange={(e) => (setA(e.target.value), update(e.target.value, b))} />
      </Field>
      <Field label="Confirm password" htmlFor="pw2" error={mismatch ? 'Passwords do not match' : undefined}>
        <PasswordInput id="pw2" autoComplete="new-password" value={b} onChange={(e) => (setB(e.target.value), update(a, e.target.value))} />
      </Field>
    </>
  );
}

export { Button };
