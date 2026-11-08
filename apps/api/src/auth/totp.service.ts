import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { ENV, Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import { decrypt, encrypt } from '../common/crypto';

authenticator.options = { window: 1, step: 30 };

@Injectable()
export class TotpService {
  constructor(@Inject(ENV) private readonly env: Env, @Inject(REDIS) private readonly redis: Redis) {}

  newSecret(): { secret: string; encrypted: string } {
    const secret = authenticator.generateSecret(20);
    return { secret, encrypted: encrypt(secret, this.env.APP_ENCRYPTION_KEY) };
  }

  async qr(email: string, secret: string): Promise<{ otpauthUri: string; qrDataUrl: string }> {
    const otpauthUri = authenticator.keyuri(email, 'WCC Media', secret);
    return { otpauthUri, qrDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 }) };
  }

  /** Verifies and blocks replay of the same code within its window. */
  async verify(userId: string, encryptedSecret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    const secret = decrypt(encryptedSecret, this.env.APP_ENCRYPTION_KEY);
    if (!authenticator.check(code, secret)) return false;
    const fresh = await this.redis.set(`totp:${userId}:${code}`, '1', 'EX', 90, 'NX');
    return fresh === 'OK';
  }

  /** 10 codes like "k3f9q-2mxa7", shown once. */
  recoveryCodes(): string[] {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 10 }, () => {
      const bytes = randomBytes(10);
      const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
      return `${s.slice(0, 5)}-${s.slice(5)}`;
    });
  }
}
