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
  const [result, setResult] = useState<{ temporaryPassword: string; fullName: string; phone: string | null } | null>(null);
  const first = name.split(' ')[0];
  const message = (p: string) =>
    `Hello ${first}, your WCC app password has been reset. Sign in at ${window.location.origin}/login with your phone number and this temporary password: ${p}\nYou'll be asked to choose your own password.`;
  return (
    <>
      <ConfirmButton
        size={size}
        variant={variant}
        title={`Reset ${name}’s password?`}
        description="They’re signed out everywhere and get a temporary password, which you send them. They choose their own when they next sign in."
        confirmLabel="Reset password"
        onConfirm={() =>
          api<{ temporaryPassword: string; fullName: string; phone: string | null }>(`/users/${userId}/reset-password`, { method: 'POST' })
            .then(setResult)
            .catch((e) => toast.error(errorMessage(e)))
        }
      >
        <KeyRound className="h-4 w-4" /> Reset password
      </ConfirmButton>
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)} title="Temporary password" description={`Send this to ${name}. It’s only shown now.`}>
        {result && (
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
            <p className="text-center text-xs text-muted">They sign in with {result.phone ? `${result.phone} (or their email)` : 'their email'} and this password, then choose their own.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
