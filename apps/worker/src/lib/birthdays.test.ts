import { describe, expect, it } from 'vitest';
import { birthdayMessages, birthdayOn, normalizePhone } from './birthdays';

describe('phones', () => {
  it('match across formats', () => {
    for (const p of ['0241234567', '+233 24 123 4567', '233241234567', '00233241234567', '024-123-4567', '241234567']) expect(normalizePhone(p)).toBe('0241234567');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('birthday dates', () => {
  it('same month and day', () => {
    expect(birthdayOn('1990-11-19', '2026-11-19')).toBe(true);
    expect(birthdayOn('1990-11-18', '2026-11-19')).toBe(false);
  });
  it('29 Feb is celebrated on 28 Feb in other years, not twice in leap years', () => {
    expect(birthdayOn('2000-02-29', '2027-02-28')).toBe(true);
    expect(birthdayOn('2000-02-29', '2028-02-28')).toBe(false);
    expect(birthdayOn('2000-02-29', '2028-02-29')).toBe(true);
  });
});

describe('birthday messages', () => {
  const ama = { id: 'm1', fullName: 'Ama Mensah', groupNames: ['Glory Basonta'], recipientIds: ['pastor', 'shepherd', 'friend', 'ama-user'], selfUserId: 'ama-user' };
  const kofi = { id: 'm2', fullName: 'Kofi Owusu', groupNames: ['Media'], recipientIds: ['pastor', 'media-lead'], selfUserId: null };
  const m = birthdayMessages([ama, kofi], '2026-11-19');
  it('the birthday person gets a personal greeting, not a "birthday today" notice', () => {
    expect(m.get('ama-user')!.title).toBe('Happy birthday, Ama! 🎉');
  });
  it('one person in your groups', () => {
    expect(m.get('friend')).toMatchObject({ title: '🎂 It’s Ama Mensah’s birthday today', url: '/church/members/m1' });
    expect(m.get('friend')!.body).toContain('Ama Mensah (Glory Basonta)');
  });
  it('several people: one notification listing them', () => {
    expect(m.get('pastor')!.title).toBe('🎂 2 birthdays today');
    expect(m.get('pastor')!.body).toContain('Kofi Owusu (Media)');
  });
  it('nobody else is told', () => {
    expect([...m.keys()].sort()).toEqual(['ama-user', 'friend', 'media-lead', 'pastor', 'shepherd']);
  });
});
