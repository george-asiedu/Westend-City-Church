import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ENV, Env } from '../config/env';
import { DeliveryService } from './delivery.service';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService, @Inject(ENV) private readonly env: Env) {}

  /** Sets the CloudFront cookies (§8.4). In presign mode this is a no-op that still returns an expiry. */
  @Get('cdn-session')
  cdnSession(@Res({ passthrough: true }) res: Response) {
    const signed = this.delivery.cdnCookies();
    if (!signed) return { mode: this.delivery.mode, expiresAt: new Date(Date.now() + 90 * 60_000).toISOString() };
    for (const [name, value] of Object.entries(signed.cookies)) {
      res.cookie(name, value, {
        domain: this.env.COOKIE_DOMAIN || undefined,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        expires: signed.expiresAt,
      });
    }
    return { mode: this.delivery.mode, expiresAt: signed.expiresAt.toISOString() };
  }
}
