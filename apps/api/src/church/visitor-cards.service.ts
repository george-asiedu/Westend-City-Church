import { Inject, Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { Prisma } from '@wcc/db';
import { badRequest } from '../common/errors';
import { cursorArgs, pageOf, pageSize } from '../common/pagination';
import { tenDigitPhone } from './audience.service';
import { blank } from './shared';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { ChurchAccess } from './shared';
import { ENV, Env } from '../config/env';

/** Welcome cards filled in by visitors (QR code). */
@Injectable()
export class VisitorCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChurchAccess,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** A visitor fills in their own card (QR code at the service). Lands in "New people". */
  async visitorCard(dto: {
    fullName: string;
    phone?: string | null;
    location?: string | null;
    howHeard?: string | null;
    prayerRequest?: string | null;
    wantsToJoin?: boolean;
    website?: string;
  }) {
    if (dto.website) return { ok: true }; // honeypot: bots fill every field
    const phone = tenDigitPhone(dto.phone);
    if (dto.phone?.trim() && !phone)
      throw badRequest('PHONE', 'Enter a 10-digit phone number, e.g. 0241234567');
    // The same person submitting twice on one day counts once.
    if (phone) {
      const dup = await this.prisma.guest.findFirst({
        where: { sessionId: null, phone, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        select: { id: true },
      });
      if (dup) return { ok: true };
    }
    await this.prisma.guest.create({
      data: {
        sessionId: null,
        fullName: dto.fullName.trim(),
        phone,
        location: blank(dto.location) ?? null,
        howHeard: blank(dto.howHeard) ?? null,
        prayerRequest: blank(dto.prayerRequest) ?? null,
        intent: dto.wantsToJoin ? 'JOINING' : 'VISIT',
      },
    });
    return { ok: true };
  }

  /** The QR code for the visitor card (print it, or show it on the screen at church). */
  async visitorCardQr(user: AuthUser) {
    this.access.leader(user);
    const url = `${this.env.WEB_ORIGIN}/welcome`;
    return { url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 600 }) };
  }

  /** Visitor cards filled in recently (all of them, not just "wants to join"). */
  async visitorCards(user: AuthUser, q: { cursor?: string; limit?: number }) {
    this.access.leader(user);
    const take = pageSize(q.limit);
    const where: Prisma.GuestWhereInput = { sessionId: null };
    const [rows, total] = await Promise.all([
      this.prisma.guest.findMany({
        where,
        include: { convertedMember: { select: { id: true, fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, take),
      }),
      this.prisma.guest.count({ where }),
    ]);
    const { items, nextCursor } = pageOf(rows, take);
    return {
      items: items.map((g) => ({
        id: g.id,
        fullName: g.fullName,
        phone: g.phone,
        intent: g.intent,
        broughtBy: null,
        convertedMember: g.convertedMember,
        fromCard: true,
        location: g.location,
        howHeard: g.howHeard,
        prayerRequest: g.prayerRequest,
        createdAt: g.createdAt.toISOString(),
      })),
      nextCursor,
      total,
    };
  }
}
