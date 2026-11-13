import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from './config/config.module';
import { ENV, Env } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { PolicyModule } from './policy/policy.module';
import { AuditModule } from './audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { DeliveryModule } from './delivery/delivery.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { InvitationsModule } from './invitations/invitations.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { EventsModule } from './events/events.module';
import { MediaModule } from './media/media.module';
import { UploadsModule } from './uploads/uploads.module';
import { TagsModule } from './tags/tags.controller';
import { TrashModule } from './trash/trash.module';
import { SearchModule } from './search/search.module';
import { HealthModule } from './health/health.module';
import { SharesModule } from './shares/shares.module';
import { ExportsModule } from './exports/exports.module';
import { HighlightsModule } from './highlights/highlights.module';
import { StatsModule } from './stats/stats.module';
import { MembershipModule } from './membership/membership.controller';
import { ChurchModule } from './church/church.controller';
import { NotificationsModule } from './notifications/notifications.controller';
import { CsrfGuard, JwtAuthGuard, RolesGuard } from './common/guards';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // Nest 11 / path-to-regexp v8 syntax for "every route".
        forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
        pinoHttp: {
          level: env.NODE_ENV === 'production' ? 'info' : 'debug',
          genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.token', '*.totp', '*.newPassword', '*.currentPassword'],
            censor: '[redacted]',
          },
          // Share tokens live in the URL path; keep them out of the logs.
          serializers: { req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, url: req.url.replace(/(public\/shares\/)[^/?]+/, '$1[token]') }) },
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          autoLogging: { ignore: (req) => (req.url ?? '').includes('/health/') },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage: new ThrottlerStorageRedisService(new Redis(env.REDIS_URL, { keyPrefix: 'wcc:throttle:' })),
      }),
    }),
    PrismaModule,
    RedisModule,
    PolicyModule,
    AuditModule,
    StorageModule,
    DeliveryModule,
    QueueModule,
    AuthModule,
    InvitationsModule,
    UsersModule,
    CategoriesModule,
    EventsModule,
    MediaModule,
    UploadsModule,
    TagsModule,
    TrashModule,
    SearchModule,
    HealthModule,
    SharesModule,
    ExportsModule,
    HighlightsModule,
    NotificationsModule,
    MembershipModule,
    ChurchModule,
    StatsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
