import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, @Inject(REDIS) private readonly redis: Redis) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.ping().then((r) => r === 'PONG').catch(() => false),
    ]);
    if (!db || !redis) throw new ServiceUnavailableException({ status: 'degraded', db, redis });
    return { status: 'ok', db, redis };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
