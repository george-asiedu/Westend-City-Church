import { UnrecoverableError, type Job } from 'bullmq';
import type { MailJob } from '@wcc/shared';
import { env } from '../env';
import { log } from '../lib/log';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Layout {
  greeting?: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  /** Short line under the button, e.g. "This link expires in 72 hours." */
  note?: string;
  /** Muted "if you did not…" line. */
  disclaimer?: string;
}

const BRAND = '#c8102e';
const INK = '#16191f';

/**
 * Transactional layout modelled on AWS's emails: a solid header band with the
 * logo, a white card, one centred block button, a muted disclaimer, a support
 * line under a divider and a grey legal footer. Table-based with inline styles
 * so it renders the same in Gmail, Outlook and Apple Mail.
 */
function layout(subjectLine: string, l: Layout): { html: string; text: string } {
  // Mail clients fetch images from the internet: only use an https URL they can reach
  // (never localhost), otherwise show a text-only header instead of a broken image.
  const logo = env.MAIL_LOGO_URL ?? (env.WEB_ORIGIN.startsWith('https://') ? `${env.WEB_ORIGIN}/logo.png` : null);
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#333">${esc(t)}</p>`;
  const button = l.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto">
         <tr><td align="center" bgcolor="${BRAND}" style="background:${BRAND}">
           <a href="${esc(l.cta.href)}" style="display:inline-block;padding:14px 56px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif">${esc(l.cta.label)}</a>
         </td></tr>
       </table>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subjectLine)}</title></head>
<body style="margin:0;padding:0;background:#f2f3f3;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f3f3" style="background:#f2f3f3">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
    <tr><td align="center" bgcolor="${INK}" style="background:${INK};padding:20px 24px">
      ${logo ? `<img src="${esc(logo)}" width="56" height="56" alt="" style="display:inline-block;border:0;vertical-align:middle;border-radius:50%">` : ''}
      <span style="display:inline-block;vertical-align:middle;${logo ? 'margin-left:12px;' : ''}color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:.3px">WCC Media</span>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:32px 32px 8px">
      ${p(l.greeting ?? 'Hello,')}
      ${l.paragraphs.map(p).join('')}
      ${button}
      ${l.note ? p(l.note) : ''}
      ${l.disclaimer ? `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#7d8998">${esc(l.disclaimer)}</p>` : ''}
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:0 32px"><div style="border-top:1px solid #e3e6e8;font-size:0;line-height:0">&nbsp;</div></td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:20px 32px 28px;font-size:12px;line-height:1.5;color:#545b64">
      If you have any questions or need help, contact the Media Bacenta team or reply to this email.
      ${l.cta ? `<br><br><span style="color:#7d8998">Button not working? Paste this link into your browser:<br><a href="${esc(l.cta.href)}" style="color:#0972d3;word-break:break-all">${esc(l.cta.href)}</a></span>` : ''}
    </td></tr>
    <tr><td align="center" style="padding:20px 24px;font-size:11px;line-height:1.5;color:#7d8998">
      ${esc(env.APP_NAME)} is the private media gallery of Westend City Church (The Life Cathedral).<br>
      You received this email because of activity on your account. This is a service message.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  const text = [
    l.greeting ?? 'Hello,',
    '',
    ...l.paragraphs,
    ...(l.cta ? ['', `${l.cta.label}: ${l.cta.href}`] : []),
    ...(l.note ? ['', l.note] : []),
    ...(l.disclaimer ? ['', l.disclaimer] : []),
    '',
    '—',
    env.APP_NAME,
  ].join('\n');
  return { html, text };
}

export function render(job: MailJob): { subject: string; html: string; text: string } {
  const d = job.data;
  const hello = d.name ? `Hello ${d.name},` : 'Hello,';
  let subject: string;
  let l: Layout;
  switch (job.template) {
    case 'invite':
      subject = `You're invited to ${env.APP_NAME}`;
      l = {
        paragraphs: [`${d.inviter ?? 'An administrator'} has invited you to join the Westend City Church media gallery as ${d.role ?? 'a member'}. To accept and create your account, click the button below.`],
        cta: { label: 'Accept invitation', href: d.link ?? env.WEB_ORIGIN },
        note: 'For your security, this link can only be used once and will expire in 72 hours.',
        disclaimer: 'If you were not expecting this invitation, you can safely ignore this email.',
      };
      break;
    case 'password-reset':
      subject = 'Reset your WCC Media password';
      l = {
        greeting: hello,
        paragraphs: ['We received a request to reset the password for your WCC Media account. To choose a new password, click the button below.'],
        cta: { label: 'Reset password', href: d.link ?? env.WEB_ORIGIN },
        note: 'For your account protection, this link can only be used once and will expire in 30 minutes. Resetting your password signs you out of all devices.',
        disclaimer: 'If you did not request a password reset, you can ignore this email. Your password will not change.',
      };
      break;
    case '2fa-enabled':
      subject = 'Two-factor authentication is now on';
      l = {
        greeting: hello,
        paragraphs: ['Two-factor authentication was just turned on for your WCC Media account. From now on you will be asked for a code from your authenticator app when you sign in.'],
        disclaimer: 'If you did not make this change, contact an administrator immediately.',
      };
      break;
    case 'email-change-verify':
      subject = 'Confirm your new WCC Media email address';
      l = {
        greeting: hello,
        paragraphs: [`You asked to change the email address on your WCC Media account to ${d.newEmail ?? 'this address'}. To confirm, click the button below.`],
        cta: { label: 'Confirm email address', href: d.link ?? env.WEB_ORIGIN },
        note: 'This link can only be used once and will expire in 60 minutes. Confirming signs you out of your other devices.',
        disclaimer: 'If you did not ask for this, you can ignore this email. Nothing will change.',
      };
      break;
    case 'email-change-requested':
      subject = 'Email change requested on your WCC Media account';
      l = {
        greeting: hello,
        paragraphs: [`Someone signed in to your WCC Media account asked to change its email address to ${d.newEmail ?? 'a new address'}. The change only happens once the new address is confirmed.`],
        disclaimer: 'If this was not you, change your password now and contact an administrator.',
      };
      break;
    case 'email-changed':
      subject = 'Your WCC Media email address was changed';
      l = {
        greeting: hello,
        paragraphs: [`The email address on your WCC Media account was changed to ${d.newEmail ?? 'a new address'}. Use the new address to sign in from now on.`],
        disclaimer: 'If you did not make this change, contact an administrator immediately.',
      };
      break;
    case 'export-ready':
      subject = `Your download is ready: ${d.title ?? ''}`;
      l = {
        paragraphs: [`The ZIP file for “${d.title ?? 'your selection'}” is ready to download.`],
        cta: { label: 'Open downloads', href: d.link ?? env.WEB_ORIGIN },
        note: 'The download will be available for 24 hours.',
      };
      break;
  }
  return { subject, ...layout(subject, l) };
}

/** `WCC Media <no-reply@x.org>` → `{ name, email }` (Plunk's format). */
export function parseAddress(value: string): string | { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!m) return value.trim();
  const name = m[1]!.trim();
  const email = m[2]!.trim();
  return name ? { name, email } : email;
}

interface PlunkResponse {
  success?: boolean;
  error?: { code?: string; message?: string; errors?: Array<{ field?: string; message?: string }> };
}

/**
 * Sends through Plunk's HTTP API (same approach as nichelle-api: no SDK).
 * `subscribed: false` keeps transactional mail from enrolling anyone in
 * marketing. The From domain must be verified in Plunk.
 * 429/5xx/network errors are retried by BullMQ; other 4xx fail permanently.
 */
export async function sendMail(job: Job<MailJob>): Promise<void> {
  if (!env.PLUNK_SECRET) throw new UnrecoverableError('PLUNK_SECRET is not set; cannot send email');
  const { subject, html } = render(job.data);
  let res: Response;
  try {
    res = await fetch(`${env.PLUNK_API_URL}/v1/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PLUNK_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: job.data.to, subject, body: html, from: parseAddress(env.MAIL_FROM), reply: env.MAIL_REPLY_TO, subscribed: false }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`Plunk unreachable: ${(e as Error).message}`); // retryable
  }
  const payload = (await res.json().catch(() => null)) as PlunkResponse | null;
  if (res.ok && payload?.success !== false) {
    log.info({ jobId: job.id, template: job.data.template }, 'mail sent');
    return;
  }
  const detail = [payload?.error?.code, payload?.error?.message, payload?.error?.errors?.map((x) => [x.field, x.message].filter(Boolean).join(': ')).join('; ')]
    .filter(Boolean)
    .join(' — ');
  const msg = `Plunk returned ${res.status}${detail ? `: ${detail}` : ''}`;
  if (res.status === 429 || res.status >= 500) throw new Error(msg);
  throw new UnrecoverableError(msg);
}
