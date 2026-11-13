import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { ENV, Env } from '../config/env';
import { AllowPending2fa, CurrentUser, SkipCsrfToken } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { badRequest } from '../common/errors';

class KeysDto {
  @IsString() @MaxLength(200) p256dh!: string;
  @IsString() @MaxLength(100) auth!: string;
}
class SubscriptionDto {
  // Push services are always https; never let a subscription point anywhere else.
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(1000) endpoint!: string;
  @ValidateNested() @Type(() => KeysDto) keys!: KeysDto;
}
class EndpointDto {
  @IsString() @MaxLength(1000) endpoint!: string;
}
class PrefsDto {
  @IsOptional() @IsBoolean() notifyReminders?: boolean;
  @IsOptional() @IsBoolean() notifyStats?: boolean;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The VAPID key the browser needs to subscribe, and this user's settings. */
  @AllowPending2fa()
  @Get()
  async config(@CurrentUser() user: AuthUser) {
    const [u, devices] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyReminders: true, notifyStats: true } }),
      this.prisma.pushSubscription.count({ where: { userId: user.id } }),
    ]);
    return { publicKey: this.env.VAPID_PUBLIC_KEY ?? null, devices, ...u };
  }

  @AllowPending2fa()
  // The service worker re-subscribes on its own and can't read the CSRF cookie; the
  // Origin check and the session cookie still apply.
  @SkipCsrfToken()
  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(@CurrentUser() user: AuthUser, @Body() dto: SubscriptionDto, @Req() req: Request) {
    if (!this.env.VAPID_PUBLIC_KEY) throw badRequest('PUSH_DISABLED', 'Push notifications aren’t set up on the server yet');
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300) || null;
    // An endpoint belongs to one browser: if someone else signs in there, it moves to them.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId: user.id, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent },
      update: { userId: user.id, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent },
    });
    // Keep the list tidy: at most 10 devices per person.
    const extra = await this.prisma.pushSubscription.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, skip: 10, select: { id: true } });
    if (extra.length) await this.prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  }

  @AllowPending2fa()
  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body() dto: EndpointDto) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: dto.endpoint } });
  }

  @AllowPending2fa()
  @Patch('preferences')
  async prefs(@CurrentUser() user: AuthUser, @Body() dto: PrefsDto) {
    return this.prisma.user.update({ where: { id: user.id }, data: dto, select: { notifyReminders: true, notifyStats: true } });
  }

  @AllowPending2fa()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('test')
  @HttpCode(202)
  async test(@CurrentUser() user: AuthUser) {
    const n = await this.prisma.pushSubscription.count({ where: { userId: user.id } });
    if (!n) throw badRequest('NO_DEVICES', 'Turn on notifications on this device first');
    await this.queue.testPush(user.id);
    return { devices: n };
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
