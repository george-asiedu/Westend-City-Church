import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@wcc/db';
import { PolicyService } from '../policy/policy.service';
import { ChurchAccess } from './shared';
import { CheckinService } from './checkin.service';
import { MemberImportService } from './member-import.service';
import type { AuthUser } from '../common/auth-user';

const policy = new PolicyService();
const user = (role: Role, id = 'u1'): AuthUser => ({ id, sid: 's', email: null, fullName: 'Test User', role, totpEnabled: false, grants: new Map() });
const meta = { ip: '127.0.0.1', userAgent: 'test' } as never;
const audit = { record: vi.fn(async () => undefined) } as never;

// ---------------------------------------------------------------- who can see / change a member's record
describe('ChurchAccess.memberAccess', () => {
  const access = (opts: { ownMemberId?: string; canEdit?: boolean }) =>
    new ChurchAccess(
      { user: { count: async ({ where }: { where: { memberId: string } }) => (where.memberId === opts.ownMemberId ? 1 : 0) } } as never,
      policy,
      { canEditMember: async () => !!opts.canEdit } as never,
    );

  it('lets leaders view any record', async () => {
    for (const r of ['SUPER_ADMIN', 'PASTOR', 'SHEPHERD'] as Role[]) await expect(access({}).memberAccess(user(r), 'm1', false)).resolves.toBeUndefined();
  });
  it('lets members view only their own record', async () => {
    await expect(access({ ownMemberId: 'm1' }).memberAccess(user('VIEWER'), 'm1', false)).resolves.toBeUndefined();
    await expect(access({ ownMemberId: 'm1' }).memberAccess(user('VIEWER'), 'm2', false)).rejects.toMatchObject({ status: 403 });
  });
  it('only lets the member’s leaders (or a Super Admin) change it', async () => {
    await expect(access({ canEdit: true }).memberAccess(user('PASTOR'), 'm1', true)).resolves.toBeUndefined();
    await expect(access({ canEdit: false }).memberAccess(user('PASTOR'), 'm1', true)).rejects.toMatchObject({ status: 403 });
    // Members can't edit even their own record through this route.
    await expect(access({ ownMemberId: 'm1', canEdit: false }).memberAccess(user('VIEWER'), 'm1', true)).rejects.toMatchObject({ status: 403 });
  });
});

// ---------------------------------------------------------------- self check-in
function checkinDb(opts: { checkedIn?: string[]; household?: Array<{ id: string; fullName: string }> } = {}) {
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const session = { id: 'svc', kind: 'CHURCH_SERVICE', serviceType: 'Sunday service', title: '1st service', date: today, checkinCode: 'code1234567', checkinUntil: new Date(Date.now() + 3600e3) };
  const records = new Map((opts.checkedIn ?? []).map((m) => [m, { memberId: m, checkedInAt: new Date() }]));
  const guests: unknown[] = [];
  const db = {
    attendanceSession: { findUnique: async () => session, findFirst: async () => ({ id: 'basonta-sheet' }), create: async () => ({ id: 'basonta-sheet' }) },
    user: { findUnique: async () => ({ memberId: null }) },
    member: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        'guardianId' in where ? (opts.household ?? []) : 'phone' in where ? [{ id: 'ama' }] : [],
      findUniqueOrThrow: async () => ({ fullName: 'Ama Mensah' }),
    },
    attendanceRecord: {
      findMany: async () => [...records.values()],
      upsert: async ({ create }: { create: { memberId: string } }) => records.set(create.memberId, { memberId: create.memberId, checkedInAt: new Date() }),
      createMany: async () => ({ count: 0 }),
      update: async () => undefined,
    },
    guest: { createMany: async ({ data }: { data: unknown[] }) => guests.push(...data), count: async () => guests.length },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db, records, guests };
}

describe('CheckinService.checkIn', () => {
  it('checks someone in by phone with the people they came with', async () => {
    const { db, records, guests } = checkinDb();
    const r = await new CheckinService(db as never, policy, audit).checkIn('code1234567', null, { phone: '0241234567', companions: [{ fullName: 'Esi', relation: 'Child' }] });
    expect(r).toMatchObject({ name: 'Ama Mensah', alreadyIn: false, companions: 1 });
    expect(records.has('ama')).toBe(true);
    expect(guests).toHaveLength(1);
  });
  it('refuses a second check-in', async () => {
    const { db } = checkinDb({ checkedIn: ['ama'] });
    await expect(new CheckinService(db as never, policy, audit).checkIn('code1234567', null, { phone: '0241234567' })).rejects.toMatchObject({ status: 409 });
  });
  it('on a second scan, only adds household members who aren’t in yet (no extra companions)', async () => {
    const { db, records, guests } = checkinDb({ checkedIn: ['ama', 'kofi'], household: [{ id: 'kofi', fullName: 'Kofi' }, { id: 'yaa', fullName: 'Yaa' }] });
    const r = await new CheckinService(db as never, policy, audit).checkIn('code1234567', null, { phone: '0241234567', householdIds: ['kofi', 'yaa', 'stranger'], companions: [{ fullName: 'Extra', relation: 'Friend' }] });
    expect(r).toMatchObject({ alreadyIn: true, household: ['Yaa'], companions: 0 });
    expect(records.has('stranger')).toBe(false);
    expect(guests).toHaveLength(0);
  });
  it('needs a real 10-digit number when not signed in', async () => {
    const { db } = checkinDb();
    await expect(new CheckinService(db as never, policy, audit).checkIn('code1234567', null, { phone: '12345' })).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------- member import (dry run)
describe('MemberImportService.importMembers', () => {
  const svc = new MemberImportService(
    {
      churchGroup: { findMany: async () => [{ id: 'b1', name: 'Glory Basonta', type: 'BASONTA', parentId: 'c1' }, { id: 'c1', name: 'Kasoa', type: 'CONSTITUENCY', parentId: null }] },
      member: { findMany: async () => [{ phone: '0241111111' }] },
    } as never,
    audit,
    { leader: () => undefined } as never,
  );
  it('sorts rows into create / duplicate / error with friendly reasons', async () => {
    const r = await svc.importMembers(
      user('PASTOR'),
      [
        { fullName: 'Ama Mensah', phone: '0242222222', dateOfBirth: '14/03/1995', basonta: 'glory basonta' },
        { fullName: 'Already Here', phone: '+233 24 111 1111' },
        { fullName: 'Twice', phone: '0242222222' },
        { fullName: 'X' },
        { fullName: 'Bad Date', dateOfBirth: '31/02/2020' },
        { fullName: 'No Such', basonta: 'Nope' },
      ],
      true,
      meta,
    );
    expect(r.summary).toEqual({ create: 1, duplicate: 2, error: 3 });
    expect(r.results.find((x) => x.fullName === 'X')?.message).toMatch(/Name is missing/);
    expect(r.results.find((x) => x.fullName === 'No Such')?.message).toMatch(/No basonta called/);
  });
});
