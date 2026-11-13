import type { PushPayload } from '@wcc/shared';

/** Ghana numbers in any common form → "0XXXXXXXXX" so members and app users match. */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('233') && d.length === 12) d = `0${d.slice(3)}`;
  if (d.length === 9) d = `0${d}`;
  return d.length >= 9 ? d : null;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Is `dob` (YYYY-MM-DD) celebrated on `date`? 29 Feb birthdays are celebrated on 28 Feb in other years. */
export function birthdayOn(dob: string, date: string): boolean {
  const [, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  if (bm === m && bd === d) return true;
  return bm === 2 && bd === 29 && m === 2 && d === 28 && !isLeap(y!);
}

export interface BirthdayPerson {
  id: string;
  fullName: string;
  /** Names of their basonta / constituency / bacentas, for context. */
  groupNames: string[];
  /** Users who should hear about it (leaders + app users in the same groups). */
  recipientIds: string[];
  /** The app user who IS this member, if any (gets a personal greeting instead). */
  selfUserId: string | null;
}

/** One notification per person: the birthdays in their groups today, or their own. */
export function birthdayMessages(people: BirthdayPerson[], date: string): Map<string, PushPayload> {
  const forUser = new Map<string, BirthdayPerson[]>();
  const out = new Map<string, PushPayload>();
  for (const p of people) {
    if (p.selfUserId) {
      out.set(p.selfUserId, {
        title: `Happy birthday, ${p.fullName.split(' ')[0]}!`,
        body: 'Everyone at Westend City Church is celebrating you today. Have a blessed day!',
        url: `/church/members/${p.id}`,
        tag: `birthday-self-${date}`,
      });
    }
    for (const u of p.recipientIds) {
      if (u === p.selfUserId) continue;
      const l = forUser.get(u) ?? [];
      if (!l.some((x) => x.id === p.id)) l.push(p);
      forUser.set(u, l);
    }
  }
  for (const [userId, list] of forUser) {
    if (out.has(userId)) continue; // it's their own birthday: keep the personal greeting
    const lines = list.slice(0, 5).map((p) => (p.groupNames.length ? `${p.fullName} (${p.groupNames[0]})` : p.fullName));
    if (list.length > 5) lines.push(`and ${list.length - 5} more`);
    out.set(userId, {
      title: list.length === 1 ? `It’s ${list[0]!.fullName}’s birthday today` : `${list.length} birthdays today`,
      body: `${lines.join('\n')}\nSend them a message to celebrate!`,
      url: list.length === 1 ? `/church/members/${list[0]!.id}` : '/church/members',
      tag: `birthdays-${date}`,
    });
  }
  return out;
}
