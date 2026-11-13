'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmButton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { whatsappLink } from '@/lib/membership';

/**
 * Super Admin: give someone a temporary password (for members who signed up with a phone
 * number and can't reset by email). Shown once; they choose their own when they next sign in.
 */
export function ResetPasswordButton({ userId, name, size = 'sm', variant = 'outline' }: { userId: string; name: string; size?: 'sm' | 'md'; variant?: 'outline' | 'ghost' }) {
  type Result = { method: 'email'; email: string; fullName: string } | { method: 'temporary'; temporaryPassword: string; fullName: string; phone: string | null };
  const [result, setResult] = useState<Result | null>(null);
  const first = name.split(' ')[0];
  const message = (p: string) =>
    `Hello ${first}, I’ve reset your password for the Westend City Church app.\n\nSign in at ${window.location.origin}/login with your phone number and this temporary password: ${p}\n\nThe app will then ask you to choose your own. God bless!`;
  return (
    <>
      <ConfirmButton
        size={size}
        variant={variant}
        title={`Reset ${name}’s password?`}
        description="Their old password stops working and they’re signed out everywhere. If they have an email address, we’ll email them a link to choose a new one. If not, you’ll get a temporary password to pass on."
        confirmLabel="Reset password"
        onConfirm={() =>
          api<Result>(`/users/${userId}/reset-password`, { method: 'POST' })
            .then((r) => (r.method === 'email' ? toast.success(`Done. We’ve emailed ${first} a link to choose a new password.`, { duration: 8000 }) : setResult(r)))
            .catch((e) => toast.error(errorMessage(e)))
        }
      >
        <KeyRound className="h-4 w-4" /> Reset password
      </ConfirmButton>
      <Dialog open={result?.method === 'temporary'} onOpenChange={(o) => !o && setResult(null)} title="Temporary password" description={`${first} doesn’t have an email address, so please send this to them. It’s only shown now.`}>
        {result?.method === 'temporary' && (
          <div className="space-y-4">
            <p className="select-all rounded-lg bg-surface-2 p-4 text-center font-mono text-2xl tracking-wider" data-temp-password>
              {result.temporaryPassword}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {result.phone && (
                <a href={whatsappLink(result.phone, message(result.temporaryPassword))} target="_blank" rel="noopener noreferrer">
                  <Button>
                    <MessageCircle className="h-4 w-4" /> Send on WhatsApp
                  </Button>
                </a>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(message(result.temporaryPassword)).then(
                    () => toast.success('Copied'),
                    () => toast.error('Couldn’t copy'),
                  )
                }
              >
                <Copy className="h-4 w-4" /> Copy message
              </Button>
            </div>
            <p className="text-center text-xs text-muted">They sign in with {result.phone ?? 'their phone number'} and this password, then choose their own.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
