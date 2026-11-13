import type { DayRollup } from '@wcc/db';
import type { PushPayload } from '@wcc/shared';

/** "Saturday" / "Sunday" / "Monday 17 Nov" */
export function dayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

const list = (names: string[], max = 4) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`);

class Inbox {
  private lines = new Map<string, string[]>();
  add(userId: string | null | undefined, line: string) {
    if (!userId) return;
    const l = this.lines.get(userId) ?? [];
    if (!l.includes(line)) l.push(line);
    this.lines.set(userId, l);
  }
  entries() {
    return [...this.lines.entries()];
  }
}

/**
 * Reminders for basontas (and constituencies without basontas) that haven't recorded
 * attendance today. Basonta pastors and shepherds hear about their basonta; head pastors
 * hear which of their basontas are still missing. One notification per person.
 */
export function reminderMessages(r: DayRollup): Map<string, PushPayload> {
  const inbox = new Inbox();
  const day = dayName(r.date);
  for (const c of r.constituencies) {
    const missing = c.basontas.filter((b) => b.present === null);
    for (const b of missing) for (const u of [b.pastorId, ...b.shepherdIds]) inbox.add(u, `${b.name} hasn’t recorded ${day}’s attendance yet.`);
    if (c.basontas.length) {
      if (missing.length) inbox.add(c.pastorId, `${missing.length} of ${c.basontas.length} basontas in ${c.name} haven’t recorded yet: ${list(missing.map((b) => b.name))}.`);
    } else if (c.present === null) {
      inbox.add(c.pastorId, `${c.name} hasn’t recorded ${day}’s attendance yet.`);
    }
  }
  const out = new Map<string, PushPayload>();
  for (const [userId, lines] of inbox.entries())
    out.set(userId, { title: `A gentle reminder about ${day}’s attendance`, body: lines.join('\n'), url: '/church/attendance/new', tag: `reminder-${r.date}` });
  return out;
}

const n = (v: number | null) => (v === null ? 'not recorded' : String(v));

/**
 * The day's numbers. Super Admins: church total and every constituency (sum of its
 * basontas). Head pastors: their constituency by basonta. Basonta pastors and shepherds:
 * their basonta against its members, and their constituency's total.
 */
export function statsMessages(r: DayRollup, superAdminIds: string[]): Map<string, PushPayload> {
  const out = new Map<string, PushPayload>();
  const day = dayName(r.date);
  const recordedCons = r.constituencies.filter((c) => c.present !== null);
  // Constituencies without basontas already show as "not recorded" in their own line.
  const missingBasontas = r.constituencies.reduce((a, c) => a + c.basontas.filter((b) => b.present === null).length, 0);
  const services = r.services.map((s) => `${s.serviceType}${s.title ? ` (${s.title})` : ''}: ${s.present}`);

  if (r.constituencies.length || r.services.length) {
    const lines = [
      ...r.constituencies.map((c) => `${c.name}: ${n(c.present)}`),
      ...services,
      ...(missingBasontas ? [`${missingBasontas} basonta${missingBasontas === 1 ? '' : 's'} didn’t record.`] : []),
    ];
    const admin: PushPayload = {
      title: `${day}: ${r.total} present across ${recordedCons.length} constituenc${recordedCons.length === 1 ? 'y' : 'ies'}`,
      body: lines.join('\n'),
      url: '/church/attendance',
      tag: `stats-${r.date}`,
    };
    for (const id of superAdminIds) out.set(id, admin);
  }

  const personal = new Map<string, { title: string; lines: string[]; url: string }>();
  const put = (userId: string | null | undefined, title: string, lines: string[], url: string) => {
    if (!userId || out.has(userId)) return; // Super Admins already get the full picture
    const cur = personal.get(userId);
    if (cur) cur.lines.push(title, ...lines);
    else personal.set(userId, { title, lines, url });
  };
  for (const c of r.constituencies) {
    put(
      c.pastorId,
      `${c.name}: ${n(c.present)} on ${day}`,
      c.basontas.length ? c.basontas.map((b) => `${b.name}: ${n(b.present)}${b.present !== null && b.members ? ` of ${b.members}` : ''}`) : [`${c.members} members`],
      `/church/groups/${c.id}`,
    );
    for (const b of c.basontas) {
      const title = b.present === null ? `${b.name}: no attendance recorded on ${day}` : `${b.name}: ${b.present} of ${b.members} present on ${day}`;
      for (const u of [b.pastorId, ...b.shepherdIds]) put(u, title, [`${c.name} total: ${n(c.present)}`], `/church/groups/${b.id}`);
    }
  }
  for (const [userId, p] of personal) out.set(userId, { title: p.title, body: p.lines.join('\n'), url: p.url, tag: `stats-${r.date}` });
  return out;
}
