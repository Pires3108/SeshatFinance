import { createHash } from 'node:crypto';

import {
  PasswordCheckUnavailableError,
  type PasswordSafetyChecker,
} from '@seshat/application';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const MAX_RESPONSE_LENGTH = 100_000;
const MAX_CONCURRENT_CHECKS = 8;

export class HibpPasswordSafetyChecker implements PasswordSafetyChecker {
  private activeChecks = 0;

  public constructor(private readonly request: typeof fetch = fetch) {}

  public async isCompromised(password: string): Promise<boolean> {
    if (this.activeChecks >= MAX_CONCURRENT_CHECKS)
      throw new PasswordCheckUnavailableError();
    this.activeChecks += 1;
    try {
      const hash = createHash('sha1')
        .update(password, 'utf8')
        .digest('hex')
        .toUpperCase();
      const prefix = hash.slice(0, 5);
      const suffix = hash.slice(5);
      const response = await this.request(`${RANGE_URL}${prefix}`, {
        method: 'GET',
        headers: {
          'Add-Padding': 'true',
          'User-Agent': 'SeshatFinance-PasswordSafety/1.0',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 200) throw new PasswordCheckUnavailableError();
      const body = await response.text();
      if (body.length === 0 || body.length > MAX_RESPONSE_LENGTH)
        throw new PasswordCheckUnavailableError();
      let compromised = false;
      let entries = 0;
      for (const entry of body.split(/\r?\n/u)) {
        if (entry.length === 0) continue;
        const match = /^([A-F0-9]{35}):(\d+)$/u.exec(entry);
        if (match === null) throw new PasswordCheckUnavailableError();
        entries += 1;
        if (match[1] === suffix && Number(match[2]) > 0) compromised = true;
      }
      if (entries === 0) throw new PasswordCheckUnavailableError();
      return compromised;
    } catch {
      throw new PasswordCheckUnavailableError();
    } finally {
      this.activeChecks -= 1;
    }
  }
}
