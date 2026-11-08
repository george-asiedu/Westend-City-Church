import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import { ENV, Env } from '../config/env';
import { badRequest } from '../common/errors';

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

zxcvbnOptions.setOptions({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: en.translations,
});

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  /** Used to equalise timing when the user does not exist (§7.2). */
  private dummyHash: Promise<string> = argon2.hash('dummy-password-for-timing', ARGON);

  constructor(@Inject(ENV) private readonly env: Env) {}

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON);
  }

  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash) {
      await argon2.verify(await this.dummyHash, plain).catch(() => false);
      return false;
    }
    return argon2.verify(hash, plain).catch(() => false);
  }

  /** Min 12 chars, zxcvbn ≥ 3, optional HaveIBeenPwned k-anonymity check (§7.1). */
  async assertStrong(password: string, userInputs: string[] = []): Promise<void> {
    if (password.length < 12) throw badRequest('WEAK_PASSWORD', 'Use at least 12 characters.');
    if (password.length > 200) throw badRequest('WEAK_PASSWORD', 'That password is too long.');
    const result = zxcvbn(password, userInputs);
    if (result.score < 3) {
      const hint = result.feedback.warning || result.feedback.suggestions[0] || 'Try a longer passphrase.';
      throw badRequest('WEAK_PASSWORD', `That password is too easy to guess. ${hint}`);
    }
    if (this.env.PWNED_PASSWORD_CHECK && (await this.isPwned(password))) {
      throw badRequest('PWNED_PASSWORD', 'That password has appeared in a data breach. Choose another.');
    }
  }

  private async isPwned(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'wcc-media' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [suffix, count] = line.trim().split(':');
        return suffix === sha1.slice(5) && Number(count) > 0;
      });
    } catch (e) {
      this.logger.warn(`HIBP check skipped: ${(e as Error).message}`);
      return false; // fail open: the service being down must not block resets
    }
  }
}
