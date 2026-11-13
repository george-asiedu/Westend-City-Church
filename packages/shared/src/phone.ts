/**
 * Ghana phone numbers. Members, app users, check-in and WhatsApp links all go through
 * these, so the same person always matches however their number was typed.
 */

/** Any common form (0XX…, +233…, 233…, 00233…, with spaces) → "0XXXXXXXXX", or null. */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('233') && d.length === 12) d = `0${d.slice(3)}`;
  if (d.length === 9) d = `0${d}`;
  return d.length >= 9 ? d : null;
}

/** Exactly 10 digits starting with 0, or null. Used wherever a phone is required. */
export function tenDigitPhone(p: string | null | undefined): string | null {
  const n = normalizePhone(p);
  return n && /^0\d{9}$/.test(n) ? n : null;
}

/** The international form WhatsApp wants (233XXXXXXXXX). */
export function whatsappNumber(p: string): string {
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `233${d.slice(1)}`;
  else if (d.length === 9) d = `233${d}`;
  return d;
}
