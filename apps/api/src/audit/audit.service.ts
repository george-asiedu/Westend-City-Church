import { Injectable } from '@nestjs/common';
import { Prisma } from '@wcc/db';
import { PrismaService } from '../prisma/prisma.service';
import type { ReqMeta } from '../common/decorators';

export type EntityType = 'USER' | 'EVENT' | 'MEDIA' | 'CATEGORY' | 'SESSION' | 'INVITATION' | 'SHARE_LINK' | 'EXPORT' | 'SETTINGS';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: EntityType;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  meta?: ReqMeta;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass `tx` to record inside the same transaction as the change (§17.5). */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
        ipAddress: entry.meta?.ip ?? null,
        userAgent: entry.meta?.userAgent ?? null,
      },
    });
  }
}
