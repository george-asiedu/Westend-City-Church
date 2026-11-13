import { describe, expect, it } from 'vitest';
import type { DayRollup } from '@wcc/db';
import { reminderMessages, statsMessages } from './notify-messages';

const b = (id: string, present: number | null, pastorId: string | null = null, shepherdIds: string[] = [], members = 10) => ({ id, name: id.toUpperCase(), pastorId, shepherdIds, members, present });

const rollup: DayRollup = {
  date: '2026-11-15', // a Sunday
  total: 70,
  constituencies: [
    { id: 'east', name: 'East', pastorId: 'head-east', members: 30, basontas: [b('b1', 40, 'p1', ['s1']), b('b2', null, 'p2', ['s2', 's3']), b('b3', 30, 'p1')], present: 70, recorded: 2, missing: 1 },
    { id: 'west', name: 'West', pastorId: 'head-west', members: 12, basontas: [], present: null, recorded: 0, missing: 1 },
  ],
  services: [{ id: 's', serviceType: 'Sunday service', title: '1st service', present: 300, visitors: 12 }],
  bacentas: [],
};

describe('reminders', () => {
  const m = reminderMessages(rollup);
  it('reach the pastor and every shepherd of a basonta that has not recorded', () => {
    for (const u of ['p2', 's2', 's3']) expect(m.get(u)?.body).toContain('B2 hasn’t recorded Sunday’s attendance');
  });
  it('do not bother leaders whose basontas recorded', () => {
    expect(m.has('p1')).toBe(false);
    expect(m.has('s1')).toBe(false);
  });
  it('tell the head pastor which basontas are missing', () => {
    expect(m.get('head-east')?.body).toBe('1 of 3 basontas in East haven’t recorded yet: B2.');
  });
  it('remind a constituency without basontas that has not recorded', () => {
    expect(m.get('head-west')?.body).toContain('West hasn’t recorded');
  });
  it('link to recording attendance and replace an earlier reminder', () => {
    expect(m.get('p2')).toMatchObject({ url: '/church/attendance/new', tag: 'reminder-2026-11-15' });
  });
});

describe('weekend stats', () => {
  const m = statsMessages(rollup, ['admin', 'head-east']);
  it('Super Admins get the church total and every constituency (sum of basontas)', () => {
    const a = m.get('admin')!;
    expect(a.title).toBe('Sunday: 70 present across 1 constituency');
    expect(a.body).toContain('East: 70');
    expect(a.body).toContain('West: not recorded');
    expect(a.body).toContain('Sunday service (1st service): 300');
    expect(a.body).toContain('1 basonta didn’t record.');
  });
  it('a head pastor who is also a Super Admin gets just the admin summary', () => {
    expect(m.get('head-east')).toEqual(m.get('admin'));
  });
  it('basonta pastors see their basonta against its members and the constituency total', () => {
    const p1 = m.get('p1')!;
    expect(p1.title).toBe('B1: 40 of 10 present on Sunday');
    expect(p1.body).toContain('East total: 70');
    expect(p1.body).toContain('B3: 30 of 10 present on Sunday'); // leads two basontas: one notification
  });
  it('leaders of a basonta that did not record are told so', () => {
    expect(m.get('s2')!.title).toBe('B2: no attendance recorded on Sunday');
  });
  it('a head pastor sees their constituency by basonta', () => {
    const w = statsMessages(rollup, []).get('head-east')!;
    expect(w.title).toBe('East: 70 on Sunday');
    expect(w.body.split('\n')).toEqual(['B1: 40 of 10', 'B2: not recorded', 'B3: 30 of 10']);
  });
});
