/*
 * Demo data for the Church side (members, groups, attendance) — LOCAL DEVELOPMENT ONLY.
 *
 *   pnpm db:demo            add the demo data (refuses if it's already there)
 *   pnpm db:demo --reset    remove the demo data, then add it again
 *   pnpm db:demo --remove   remove the demo data only
 *
 * Everything it creates is tagged (users @demo.wcc.local, phones 0209xxxxxx, groups/members
 * created by those users), so --remove takes away exactly this and nothing else.
 * Refuses to run in production or against any database that isn't on this machine.
 */
import { PrismaClient, type GroupType, type GuestIntent } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const DOMAIN = 'demo.wcc.local';
const PASSWORD = 'DemoChurch#2026';
const WEEKS = 8;

// ---------------------------------------------------------------- safety
function assertLocal(): void {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://x');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing: NODE_ENV is production.');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`Refusing: ${url.hostname} is not a local database.`);
}

// ---------------------------------------------------------------- deterministic randomness
let seed = 20261115;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
const chance = (p: number) => rand() < p;
const sample = <T>(a: readonly T[], n: number): T[] => [...a].sort(() => rand() - 0.5).slice(0, n);
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST_M = ['Kwame', 'Kofi', 'Kojo', 'Yaw', 'Kwabena', 'Kwaku', 'Kwesi', 'Nana', 'Emmanuel', 'Daniel', 'Samuel', 'Prince', 'Isaac', 'Joseph', 'Michael', 'Eric', 'Felix', 'Richard'];
const FIRST_F = ['Ama', 'Akosua', 'Abena', 'Adwoa', 'Yaa', 'Afua', 'Esi', 'Efua', 'Akua', 'Grace', 'Mercy', 'Abigail', 'Priscilla', 'Joyce', 'Gifty', 'Linda', 'Naomi', 'Esther'];
const LAST = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Osei', 'Agyeman', 'Appiah', 'Darko', 'Ofori', 'Amoah', 'Addo', 'Quartey', 'Tetteh', 'Ansah', 'Frimpong', 'Danso', 'Acheampong', 'Nkrumah', 'Badu', 'Sarpong'];

const day = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Most recent Sunday on or before today. */
function lastSunday(): Date {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

// ---------------------------------------------------------------- remove
async function remove(): Promise<void> {
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return console.log('No demo data found.');
  // Sessions recorded by demo leaders (church-wide ones have no group to cascade from).
  await prisma.attendanceSession.deleteMany({ where: { OR: [{ recordedById: { in: ids } }, { group: { createdById: { in: ids } } }] } });
  await prisma.member.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.churchGroup.deleteMany({ where: { createdById: { in: ids }, type: 'BASONTA' } });
  await prisma.churchGroup.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed the demo data (${ids.length} demo logins and everything they created).`);
}

// ---------------------------------------------------------------- create
async function create(): Promise<void> {
  if (await prisma.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } })) {
    throw new Error('Demo data is already there. Use --reset to recreate it or --remove to take it away.');
  }
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  let phoneN = 0;
  const phone = () => `0209${String(100000 + phoneN++).slice(-6)}`;

  // Leaders (app logins).
  const mkUser = (fullName: string, role: 'PASTOR' | 'SHEPHERD', title: string | null) =>
    prisma.user.create({
      data: {
        email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@${DOMAIN}`,
        fullName,
        title,
        phone: phone(),
        role,
        status: 'ACTIVE',
        passwordHash,
        passwordChangedAt: new Date(),
        createdAt: addDays(new Date(), -between(5, 200)),
      },
    });
  const pastors = await Promise.all(
    ['Samuel Owusu', 'Grace Asante', 'Michael Boateng', 'Joyce Mensah', 'Daniel Agyeman', 'Esther Ofori', 'Richard Appiah'].map((n, i) =>
      mkUser(n, 'PASTOR', i % 3 === 0 ? 'Rev.' : 'Ps.'),
    ),
  );
  const shepherds = await Promise.all(
    ['Kojo Darko', 'Abena Addo', 'Yaw Tetteh', 'Efua Quartey', 'Kwesi Ansah', 'Akua Frimpong', 'Felix Danso', 'Naomi Badu', 'Prince Sarpong'].map((n) => mkUser(n, 'SHEPHERD', null)),
  );
  // Two leaders joined recently, so the "New" badges show.
  await prisma.user.updateMany({ where: { id: { in: [pastors[6]!.id, shepherds[8]!.id] } }, data: { createdAt: addDays(new Date(), -6) } });
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } });

  const mkGroup = (type: GroupType, name: string, pastorId: string | null, extra: Record<string, unknown> = {}) =>
    prisma.churchGroup.create({ data: { type, name, pastorId, createdById: pastors[0]!.id, ...extra } });

  // Constituencies, each with a head pastor, and basontas inside them.
  const plan: Array<[string, number, string[]]> = [
    ['East Legon', 0, ['Glory Basonta', 'Grace Basonta', 'Victory Basonta']],
    ['Spintex', 1, ['Joy Basonta', 'Peace Basonta']],
    ['Madina', 2, ['Faith Basonta', 'Hope Basonta', 'Love Basonta']],
    ['Tema', 3, ['Zion Basonta', 'Bethel Basonta']],
    ['Kasoa', 4, ['Shiloh Basonta', 'Canaan Basonta']],
  ];
  const constituencies = [];
  const basontas: Array<{ id: string; parentId: string; skipLastSaturday: boolean }> = [];
  let sh = 0;
  for (const [name, p, kids] of plan) {
    const c = await mkGroup('CONSTITUENCY', name, pastors[p]!.id, { meetingDay: 'Sundays after service', meetingPlace: `${name} chapel` });
    constituencies.push(c);
    for (const [i, k] of kids.entries()) {
      // Head pastor leads the first basonta; others get the spare pastors or none.
      const pastorId = i === 0 ? pastors[p]!.id : i === 1 ? pastors[5 + (p % 2)]!.id : null;
      const b = await mkGroup('BASONTA', k, pastorId, { parentId: c.id, meetingDay: 'Saturdays 4pm', meetingPlace: `${name}, ${pick(['school block', 'community centre', 'church annex', 'house fellowship'])}` });
      await prisma.groupShepherd.createMany({ data: [{ groupId: b.id, userId: shepherds[sh++ % shepherds.length]!.id }, ...(chance(0.5) ? [{ groupId: b.id, userId: shepherds[sh++ % shepherds.length]!.id }] : [])], skipDuplicates: true });
      basontas.push({ id: b.id, parentId: c.id, skipLastSaturday: (k === 'Peace Basonta' || k === 'Canaan Basonta' || k === 'Love Basonta') });
    }
  }

  // Bacentas (ministries) with teams.
  const bacentaPlan: Array<[string, number, string[]]> = [
    ['Media', 6, ['Mixing', 'Projection', 'Camera', 'Live streaming', 'Social media']],
    ['Choir', 1, ['Soprano', 'Alto', 'Tenor', 'Bass', 'Instrumentalists']],
    ['Ushers', 3, ['Door', 'Seating', 'Offering', 'Protocol']],
    ['Dancing Stars', 1, ['Dancers', 'Choreography', 'Costumes']],
    ['Airport Stars', 5, ['Welcome', 'Hospitality', 'Follow-up']],
    ['Prayer Team', 0, ['Intercessors', 'Prayer walk']],
  ];
  const bacentas = [];
  for (const [name, p, teams] of bacentaPlan) {
    const g = await mkGroup('BACENTA', name, pastors[p]!.id, {
      meetingDay: pick(['Thursdays 6pm', 'Fridays 6:30pm', 'Saturdays 10am']),
      meetingPlace: 'Main auditorium',
      // The Ushers record the Sunday head-counts.
      recordsServices: name === 'Ushers',
      ...(name === 'Ushers' ? { shepherds: { create: { userId: shepherds[2]!.id } } } : {}),
    });
    const roles = [];
    for (const [i, t] of teams.entries()) roles.push(await prisma.bacentaRole.create({ data: { groupId: g.id, name: t, sortOrder: i } }));
    bacentas.push({ g, roles });
  }

  // Members.
  const members: Array<{ id: string; isActive: boolean; basonta: { id: string; parentId: string; skipLastSaturday: boolean } }> = [];
  const N = 84;
  for (let i = 0; i < N; i++) {
    const female = chance(0.55);
    const fullName = `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
    const b = basontas[i % basontas.length]!;
    const joined = addDays(lastSunday(), -between(60, 1500));
    const m = await prisma.member.create({
      data: {
        fullName,
        phone: phone(),
        gender: female ? 'Female' : 'Male',
        dateOfBirth: day(addDays(new Date('1975-01-01'), between(0, 30 * 365))),
        location: pick(['East Legon', 'Spintex Road', 'Madina Zongo Junction', 'Tema Comm. 25', 'Kasoa Old Barrier', 'Adenta', 'Ashaley Botwe', 'Lashibi', 'Haatso', 'Dzorwulu']),
        churchRole: i % 17 === 0 ? 'Shepherd' : i % 11 === 0 ? 'Basonta leader' : i % 23 === 0 ? 'Usher' : i < 3 ? 'New convert' : 'Member',
        constituencyId: b.parentId,
        basontaId: b.id,
        joinedOn: day(joined),
        isActive: i % 29 !== 7,
        createdById: pastors[0]!.id,
        createdAt: joined,
      },
    });
    members.push({ ...m, basonta: b });
    // About 60% serve in one or two bacentas, with one or two teams each.
    for (const { g, roles } of chance(0.6) ? sample(bacentas, chance(0.25) ? 2 : 1) : []) {
      await prisma.memberBacenta.create({ data: { memberId: m.id, groupId: g.id } });
      for (const r of sample(roles, chance(0.3) ? 2 : 1)) await prisma.memberBacentaRole.create({ data: { memberId: m.id, groupId: g.id, roleId: r.id } });
    }
  }
  // Team leads and an overall lead per bacenta.
  for (const { g, roles } of bacentas) {
    const inIt = await prisma.memberBacenta.findMany({ where: { groupId: g.id }, include: { roles: true } });
    if (inIt.length) await prisma.churchGroup.update({ where: { id: g.id }, data: { leadMemberId: inIt[0]!.memberId } });
    for (const r of roles) {
      const holder = inIt.find((x) => x.roles.some((y) => y.roleId === r.id));
      if (holder && chance(0.8)) await prisma.bacentaRole.update({ where: { id: r.id }, data: { leadId: holder.memberId } });
    }
  }

  // Attendance: 8 weekends.
  const active = members.filter((m) => m.isActive);
  const sunday0 = lastSunday();
  const guestName = () => `${pick(chance(0.5) ? FIRST_F : FIRST_M)} ${pick(LAST)}`;
  let sessions = 0;
  let guests = 0;
  const record = async (
    data: { kind: 'CHURCH_SERVICE' | 'GROUP_MEETING'; groupId?: string; serviceType: string; title?: string; date: Date; recordedById: string },
    roster: typeof members,
    rate: number,
    withGuests: boolean,
  ) => {
    const present = roster.filter(() => chance(rate));
    const visitors = data.kind === 'CHURCH_SERVICE' ? between(4, 18) : between(0, 3);
    const s = await prisma.attendanceSession.create({
      data: { ...data, date: day(data.date), visitorCount: visitors, firstTimerCount: Math.floor(visitors * (0.2 + rand() * 0.3)), createdAt: data.date, updatedAt: data.date },
    });
    sessions++;
    for (const m of present) {
      // About a fifth say whether they brought someone (mostly nobody).
      const asked = withGuests && chance(0.22);
      const brought = asked ? (chance(0.65) ? 0 : between(1, 3)) : null;
      await prisma.attendanceRecord.create({ data: { sessionId: s.id, memberId: m.id, broughtCount: brought } });
      for (let k = 0; k < (brought ?? 0); k++) {
        const intent: GuestIntent = chance(0.35) ? 'JOINING' : 'VISIT';
        await prisma.guest.create({
          data: { sessionId: s.id, broughtById: m.id, fullName: chance(0.8) ? guestName() : null, phone: chance(0.6) ? phone() : null, intent, createdAt: data.date },
        });
        guests++;
      }
    }
    return s;
  };

  /** Church services: the ushers' head-count (total, visitors, new converts) — no member ticks. */
  const service = async (serviceType: string, title: string | null, date: Date, total: number, by: string) => {
    const visitors = between(Math.floor(total * 0.05), Math.floor(total * 0.12));
    const converts = between(0, Math.max(1, Math.floor(total * 0.03)));
    await prisma.attendanceSession.create({
      data: { kind: 'CHURCH_SERVICE', serviceType, title, date: day(date), headcount: total, visitorCount: visitors, newConvertCount: converts, recordedById: by, createdAt: date, updatedAt: date },
    });
    sessions++;
  };
  const usher = shepherds[2]!.id;

  for (let w = WEEKS - 1; w >= 0; w--) {
    const sun = addDays(sunday0, -7 * w);
    const sat = addDays(sun, -1);
    const trend = 0.62 + (WEEKS - w) * 0.025; // attendance creeping up week by week
    // Saturday basonta meetings (a few basontas haven't recorded the latest one).
    for (const b of basontas) {
      if (w === 0 && b.skipLastSaturday) continue;
      if (chance(0.05)) continue; // the odd missed week
      const roster = active.filter((m) => m.basonta.id === b.id);
      const g = await prisma.churchGroup.findUniqueOrThrow({ where: { id: b.id }, select: { pastorId: true } });
      await record({ kind: 'GROUP_MEETING', groupId: b.id, serviceType: 'Meeting', date: sat, recordedById: g.pastorId ?? pastors[0]!.id }, roster, trend + 0.1, true);
    }
    // Sunday 1st and 2nd service head-counts (recorded by the ushers).
    await service('Sunday service', '1st service', sun, Math.round(140 * trend) + between(-8, 8), usher);
    await service('Sunday service', '2nd service', sun, Math.round(90 * trend) + between(-6, 6), usher);
    // Bacenta rehearsals.
    for (const { g } of bacentas) {
      if (chance(0.3)) continue;
      const inIt = new Set((await prisma.memberBacenta.findMany({ where: { groupId: g.id }, select: { memberId: true } })).map((x) => x.memberId));
      await record({ kind: 'GROUP_MEETING', groupId: g.id, serviceType: pick(['Rehearsal', 'Meeting']), date: addDays(sun, -2), recordedById: g.pastorId! }, active.filter((m) => inIt.has(m.id)), 0.75, false);
    }
    // Specials.
    if (w === 5) await service('All-night service', null, addDays(sun, -2), between(110, 150), usher);
    if (w === 3) {
      await service('Camp', 'Day 1', addDays(sun, -2), between(70, 90), usher);
      await service('Camp', 'Day 2', addDays(sun, -1), between(80, 100), usher);
    }
  }

  // A few people who were brought have since become members.
  const joining = await prisma.guest.findMany({ where: { intent: 'JOINING', fullName: { not: null }, session: { recordedById: { in: pastors.map((p) => p.id) } } }, take: 4, orderBy: { createdAt: 'asc' } });
  for (const g of joining.slice(0, 3)) {
    const b = pick(basontas);
    const m = await prisma.member.create({
      data: { fullName: g.fullName!, phone: g.phone ?? phone(), churchRole: 'New convert', constituencyId: b.parentId, basontaId: b.id, joinedOn: day(new Date()), createdById: pastors[0]!.id },
    });
    await prisma.guest.update({ where: { id: g.id }, data: { convertedMemberId: m.id } });
  }

  console.log(`Demo data added:
  ${constituencies.length} constituencies, ${basontas.length} basontas, ${bacentas.length} bacentas (${bacentas.reduce((a, b) => a + b.roles.length, 0)} teams)
  ${N + 3} members, ${pastors.length} pastors, ${shepherds.length} shepherds
  ${sessions} attendance records over ${WEEKS} weekends (services are head-counts; members are recorded in basontas) (Sundays ${iso(addDays(sunday0, -7 * (WEEKS - 1)))} … ${iso(sunday0)}), ${guests} people brought
  ${admin ? `Your Super Admin (${admin.email}) sees everything.` : ''}
  Demo logins (password ${PASSWORD}):
    head pastor   ${pastors[0]!.email}
    pastor        ${pastors[5]!.email}
    shepherd      ${shepherds[0]!.email}
    usher         ${shepherds[2]!.email}  (records the Sunday head-counts)
  (Pastors and shepherds don't need 2FA, so they can sign in straight away.)`);
}

async function main(): Promise<void> {
  assertLocal();
  const args = process.argv.slice(2); // pnpm may pass a bare "--" first
  if (args.includes('--remove') || args.includes('--reset')) await remove();
  if (!args.includes('--remove')) await create();
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
