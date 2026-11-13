import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditService } from '../audit/audit.service';
import { AppException, badRequest, forbidden, notFound } from '../common/errors';
import { HttpStatus } from '@nestjs/common';
import { fromDateOnly } from '../common/pagination';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { tenDigitPhone } from './audience.service';

/** Ghana is on UTC all year, so the church's "today" is the UTC date. */
const today = () => new Date().toISOString().slice(0, 10);
export const RELATIONS = ['Child', 'Relative', 'Friend', 'Other'] as const;

export interface Companion {
  fullName: string;
  relation: string;
}

/**
 * Self check-in for church services: ushers open check-in for a service, which gives it a
 * QR code valid that day only. Members scan it and check themselves in, plus the people who
 * check in with them (children and members without a phone: their "household"), and anyone
 * else who came with them (recorded as people they brought).
 */
@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ ushers

  private async serviceFor(user: AuthUser, id: string) {
    const s = await this.prisma.attendanceSession.findUnique({ where: { id } });
    if (!s) throw notFound('Service');
    if (s.kind !== 'CHURCH_SERVICE') throw badRequest('NOT_SERVICE', 'Self check-in is for church services');
    if (!this.policy.canRecordSunday(user))
      throw forbidden('Only the ushers or a Super Admin can open check-in');
    return s;
  }

  async status(user: AuthUser, id: string) {
    const s = await this.serviceFor(user, id);
    const [members, self, family, phone, companions] = await Promise.all([
      this.prisma.attendanceRecord.count({ where: { sessionId: id } }),
      this.prisma.attendanceRecord.count({ where: { sessionId: id, via: 'SELF' } }),
      this.prisma.attendanceRecord.count({ where: { sessionId: id, via: 'FAMILY' } }),
      this.prisma.attendanceRecord.count({ where: { sessionId: id, via: 'PHONE' } }),
      this.prisma.guest.count({ where: { sessionId: id, relation: { not: null } } }),
    ]);
    const open =
      !!s.checkinCode && !!s.checkinUntil && s.checkinUntil > new Date() && fromDateOnly(s.date) === today();
    return {
      open,
      code: open ? s.checkinCode : null,
      until: open ? s.checkinUntil!.toISOString() : null,
      isToday: fromDateOnly(s.date) === today(),
      counts: { members, self, family, phone, companions, total: members + companions },
    };
  }

  async open(user: AuthUser, id: string, hours: number, meta: ReqMeta) {
    const s = await this.serviceFor(user, id);
    if (fromDateOnly(s.date) !== today())
      throw badRequest('NOT_TODAY', 'Check-in can only be opened on the day of the service');
    const until = new Date(Math.min(Date.now() + hours * 3_600_000, Date.parse(`${today()}T23:59:59Z`)));
    await this.prisma.attendanceSession.update({
      where: { id },
      data: { checkinCode: s.checkinCode ?? randomBytes(15).toString('base64url'), checkinUntil: until },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'CHECKIN_OPENED',
      entityType: 'SETTINGS',
      entityId: id,
      metadata: { until: until.toISOString() },
      meta,
    });
    return this.status(user, id);
  }

  async close(user: AuthUser, id: string, meta: ReqMeta) {
    await this.serviceFor(user, id);
    // A new code next time, so an old photo of the QR stops working.
    await this.prisma.attendanceSession.update({
      where: { id },
      data: { checkinCode: null, checkinUntil: null },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'CHECKIN_CLOSED',
      entityType: 'SETTINGS',
      entityId: id,
      meta,
    });
    return this.status(user, id);
  }

  /**
   * Marks members present on their basonta's sheet for this service (same date, service type
   * and title), creating that sheet if the basonta hasn't started one. One record per member and
   * sheet, so the pastor ticking them again doesn't count them twice.
   */
  private async markBasontas(
    service: { id: string; date: Date; serviceType: string; title: string | null },
    memberIds: string[],
    at: Date,
  ) {
    const members = await this.prisma.member.findMany({
      where: { id: { in: memberIds }, basontaId: { not: null } },
      select: { id: true, basontaId: true },
    });
    const byBasonta = new Map<string, string[]>();
    for (const m of members) byBasonta.set(m.basontaId!, [...(byBasonta.get(m.basontaId!) ?? []), m.id]);
    for (const [groupId, ids] of byBasonta) {
      const match = {
        kind: 'GROUP_MEETING' as const,
        groupId,
        date: service.date,
        serviceType: { equals: service.serviceType, mode: 'insensitive' as const },
        title: service.title ? { equals: service.title, mode: 'insensitive' as const } : null,
      };
      let sheet = await this.prisma.attendanceSession.findFirst({ where: match, select: { id: true } });
      if (!sheet) {
        try {
          sheet = await this.prisma.attendanceSession.create({
            data: {
              kind: 'GROUP_MEETING',
              groupId,
              date: service.date,
              serviceType: service.serviceType,
              title: service.title,
              notes: 'Started by self check-in at the church service.',
            },
            select: { id: true },
          });
        } catch {
          sheet = await this.prisma.attendanceSession.findFirst({ where: match, select: { id: true } }); // someone else just made it
        }
      }
      if (sheet)
        await this.prisma.attendanceRecord.createMany({
          data: ids.map((memberId) => ({ sessionId: sheet!.id, memberId, via: 'SELF', checkedInAt: at })),
          skipDuplicates: true,
        });
    }
  }

  // ------------------------------------------------------------ members (public)

  private async live(code: string) {
    const s = await this.prisma.attendanceSession.findUnique({ where: { checkinCode: code } });
    if (!s || !s.checkinUntil || s.checkinUntil <= new Date() || fromDateOnly(s.date) !== today())
      throw badRequest('CHECKIN_CLOSED', 'Check-in for this service is closed. Please see an usher.');
    return s;
  }

  private household(memberId: string) {
    return this.prisma.member.findMany({
      where: { guardianId: memberId, isActive: true },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /** What the scan page shows. Signed-in members with a linked record see themselves and their household. */
  async info(code: string, user: AuthUser | null) {
    const s = await this.live(code);
    const memberId = user
      ? ((await this.prisma.user.findUnique({ where: { id: user.id }, select: { memberId: true } }))
          ?.memberId ?? null)
      : null;
    const service = { serviceType: s.serviceType, title: s.title, date: fromDateOnly(s.date)! };
    if (!memberId) return { service, me: null };
    const [m, household, done] = await Promise.all([
      this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { id: true, fullName: true } }),
      this.household(memberId),
      this.prisma.attendanceRecord.findMany({ where: { sessionId: s.id }, select: { memberId: true } }),
    ]);
    const inIds = new Set(done.map((d) => d.memberId));
    return {
      service,
      me: {
        id: m.id,
        fullName: m.fullName,
        checkedIn: inIds.has(m.id),
        household: household.map((h) => ({ ...h, checkedIn: inIds.has(h.id) })),
      },
    };
  }

  /**
   * Checks people in. Signed in: the member linked to the account. Otherwise by phone number
   * (only works at that day's open QR code). Each person is also marked present on their
   * basonta's sheet for this service.
   */
  async checkIn(
    code: string,
    user: AuthUser | null,
    dto: { phone?: string; householdIds?: string[]; companions?: Companion[] },
  ) {
    const s = await this.live(code);
    let memberId: string | null = null;
    let via: 'SELF' | 'PHONE' = 'SELF';
    if (user)
      memberId =
        (await this.prisma.user.findUnique({ where: { id: user.id }, select: { memberId: true } }))
          ?.memberId ?? null;
    if (!memberId) {
      const phone = tenDigitPhone(dto.phone);
      if (!phone)
        throw badRequest(
          'PHONE',
          user
            ? 'Your account isn’t linked to a member record. Enter your phone number instead.'
            : 'Enter your 10-digit phone number, e.g. 0241234567',
        );
      const matches = await this.prisma.member.findMany({
        where: { isActive: true, phone: { in: [phone, `+233${phone.slice(1)}`, `233${phone.slice(1)}`] } },
        select: { id: true },
        take: 2,
      });
      if (matches.length !== 1)
        throw badRequest(
          'NOT_FOUND',
          matches.length
            ? 'More than one member has that number. Please see an usher.'
            : 'We couldn’t find that number. Please see an usher, who can add you.',
        );
      memberId = matches[0]!.id;
      via = 'PHONE';
    }
    const household = await this.household(memberId);
    const allowed = new Set(household.map((h) => h.id));
    // Nobody checks in twice: people already in this service are skipped, and a second check-in
    // is refused unless it adds household members who aren't in yet.
    const already = new Map(
      (
        await this.prisma.attendanceRecord.findMany({
          where: { sessionId: s.id, memberId: { in: [memberId, ...allowed] } },
          select: { memberId: true, checkedInAt: true },
        })
      ).map((r) => [r.memberId, r.checkedInAt]),
    );
    const selfIn = already.has(memberId);
    const extra = (dto.householdIds ?? []).filter((id) => allowed.has(id) && !already.has(id));
    if (selfIn && !extra.length) {
      const at = already.get(memberId);
      throw new AppException(
        HttpStatus.CONFLICT,
        'ALREADY_CHECKED_IN',
        `You’re already checked in for this service${at ? ` (at ${at.toISOString().slice(11, 16)})` : ''}. No need to do it again.`,
      );
    }
    // People with them are recorded on the first check-in only, so they can't be added twice.
    const companions = selfIn ? [] : (dto.companions ?? []).filter((c) => c.fullName.trim()).slice(0, 15);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const mark = (id: string, how: string) =>
        tx.attendanceRecord.upsert({
          where: { sessionId_memberId: { sessionId: s.id, memberId: id } },
          create: { sessionId: s.id, memberId: id, via: how, checkedInAt: now },
          update: {},
        });
      if (!selfIn) await mark(memberId!, via);
      for (const id of extra) await mark(id, 'FAMILY');
      if (companions.length) {
        await tx.guest.createMany({
          data: companions.map((c) => ({
            sessionId: s.id,
            broughtById: memberId!,
            fullName: c.fullName.trim(),
            relation: (RELATIONS as readonly string[]).includes(c.relation) ? c.relation : 'Other',
            intent: 'VISIT' as const,
          })),
        });
        const brought = await tx.guest.count({ where: { sessionId: s.id, broughtById: memberId! } });
        await tx.attendanceRecord.update({
          where: { sessionId_memberId: { sessionId: s.id, memberId: memberId! } },
          data: { broughtCount: brought },
        });
      }
    });
    await this.markBasontas(s, [...(selfIn ? [] : [memberId]), ...extra], now);
    const me = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { fullName: true },
    });
    return {
      ok: true,
      name: me.fullName,
      alreadyIn: selfIn,
      household: extra.map((id) => household.find((h) => h.id === id)!.fullName),
      companions: companions.length,
      // Phone check-ins see who checks in with them, so they can tick them next time.
      householdChoices: via === 'PHONE' ? household.map((h) => ({ id: h.id, name: h.fullName })) : undefined,
    };
  }
}
