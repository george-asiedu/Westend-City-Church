import { Injectable } from '@nestjs/common';
import { Prisma } from '@wcc/db';
import type { ImportRowResult } from '@wcc/shared';
import { badRequest } from '../common/errors';
import { toDateOnly } from '../common/pagination';
import { normalizePhone } from './audience.service';
import { today } from './shared';
import type { AuthUser } from '../common/auth-user';
import type { ReqMeta } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ChurchAccess } from './shared';

export interface ImportRow {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  location?: string | null;
  churchRole?: string | null;
  constituency?: string | null;
  basonta?: string | null;
  bacentas?: string | null;
  joinedOn?: string | null;
}

/** Importing members from a spreadsheet. */
@Injectable()
export class MemberImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: ChurchAccess,
  ) {}

  /**
   * Imports members from a spreadsheet (already parsed by the browser). `dryRun` checks every
   * row and reports what would happen; otherwise creates the valid, non-duplicate rows.
   */
  async importMembers(user: AuthUser, rows: ImportRow[], dryRun: boolean, meta: ReqMeta) {
    this.access.leader(user);
    if (rows.length > 2000) throw badRequest('TOO_MANY', 'Import at most 2,000 rows at a time');
    const groups = await this.prisma.churchGroup.findMany({
      select: { id: true, name: true, type: true, parentId: true },
    });
    const find = (type: string, name: string | null | undefined) =>
      name?.trim()
        ? groups.find((g) => g.type === type && g.name.toLowerCase() === name.trim().toLowerCase())
        : undefined;
    const existingPhones = new Set(
      (await this.prisma.member.findMany({ where: { phone: { not: null } }, select: { phone: true } }))
        .map((m) => normalizePhone(m.phone))
        .filter(Boolean),
    );
    const seen = new Set<string>();
    const date = (v: string | null | undefined): Date | null | 'bad' => {
      if (!v?.trim()) return null;
      const s = v.trim();
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? s
        : /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.test(s)
          ? s.replace(
              /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
              (_, d, m, y) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
            )
          : null;
      return iso && !Number.isNaN(Date.parse(iso)) && iso <= today() ? toDateOnly(iso) : 'bad';
    };
    const results: ImportRowResult[] = [];
    const toCreate: Array<{ data: Prisma.MemberUncheckedCreateInput; bacentaIds: string[] }> = [];
    rows.forEach((r, i) => {
      const row = i + 2; // header is row 1
      const fullName = (r.fullName ?? '').trim();
      const fail = (message: string) =>
        results.push({ row, fullName: fullName || '(no name)', status: 'error', message });
      if (fullName.length < 2) return fail('Name is missing');
      const phone = normalizePhone(r.phone);
      if (r.phone?.trim() && !phone) return fail(`Phone “${r.phone}” doesn’t look right`);
      if (phone && (existingPhones.has(phone) || seen.has(phone)))
        return results.push({
          row,
          fullName,
          status: 'duplicate',
          message: `${phone} is already ${seen.has(phone) ? 'earlier in this file' : 'a member'}`,
        });
      const email = r.email?.trim() || null;
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return fail(`Email “${email}” doesn’t look right`);
      const dob = date(r.dateOfBirth);
      if (dob === 'bad')
        return fail(`Date of birth “${r.dateOfBirth}” isn’t a date (use YYYY-MM-DD or DD/MM/YYYY)`);
      const joined = date(r.joinedOn);
      if (joined === 'bad') return fail(`Joined date “${r.joinedOn}” isn’t a date`);
      const basonta = find('BASONTA', r.basonta);
      if (r.basonta?.trim() && !basonta) return fail(`No basonta called “${r.basonta}”`);
      let constituency = find('CONSTITUENCY', r.constituency);
      if (r.constituency?.trim() && !constituency) return fail(`No constituency called “${r.constituency}”`);
      if (basonta?.parentId) {
        if (constituency && constituency.id !== basonta.parentId)
          return fail(`${basonta.name} isn’t in ${constituency.name}`);
        constituency = groups.find((g) => g.id === basonta.parentId);
      }
      const bacentaNames = (r.bacentas ?? '')
        .split(/[;,]/)
        .map((x) => x.trim())
        .filter(Boolean);
      const bacentas = bacentaNames.map((n) => find('BACENTA', n));
      const missing = bacentaNames.filter((_, k) => !bacentas[k]);
      if (missing.length) return fail(`No bacenta called “${missing[0]}”`);
      const gender = r.gender?.trim()
        ? /^f/i.test(r.gender)
          ? 'Female'
          : /^m/i.test(r.gender)
            ? 'Male'
            : null
        : null;
      if (phone) seen.add(phone);
      results.push({ row, fullName, status: 'create', message: null });
      toCreate.push({
        data: {
          fullName,
          phone,
          email,
          gender,
          dateOfBirth: dob,
          joinedOn: joined,
          location: r.location?.trim() || null,
          churchRole: r.churchRole?.trim() || 'Member',
          constituencyId: constituency?.id ?? null,
          basontaId: basonta?.id ?? null,
          createdById: user.id,
        },
        bacentaIds: [...new Set(bacentas.map((b) => b!.id))],
      });
    });
    const summary = {
      create: toCreate.length,
      duplicate: results.filter((r) => r.status === 'duplicate').length,
      error: results.filter((r) => r.status === 'error').length,
    };
    if (!dryRun && toCreate.length) {
      for (let i = 0; i < toCreate.length; i += 200) {
        await this.prisma.$transaction(async (tx) => {
          for (const c of toCreate.slice(i, i + 200)) {
            const m = await tx.member.create({ data: c.data });
            if (c.bacentaIds.length)
              await tx.memberBacenta.createMany({
                data: c.bacentaIds.map((groupId) => ({ memberId: m.id, groupId })),
              });
          }
        });
      }
      await this.audit.record({
        actorId: user.id,
        action: 'MEMBERS_IMPORTED',
        entityType: 'MEMBER',
        metadata: summary,
        meta,
      });
    }
    return {
      dryRun,
      summary,
      results: results.filter((r) => r.status !== 'create' || dryRun).slice(0, 2000),
    };
  }
}
