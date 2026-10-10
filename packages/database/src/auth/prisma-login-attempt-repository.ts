import { createHmac } from 'node:crypto';

import type { LoginAttemptRepository } from '@seshat/application';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaLoginAttemptRepository implements LoginAttemptRepository {
  public constructor(
    private readonly clientFactory: () => PrismaClient,
    private readonly keyFactory: () => string,
  ) {}

  public async isLocked(email: string, now: Date): Promise<boolean> {
    const rows = await this.clientFactory().$queryRaw<
      readonly { locked: boolean }[]
    >`
      SELECT EXISTS (
        SELECT 1 FROM auth_login_attempts
        WHERE email_hash = ${this.hashEmail(email)} AND locked_until > ${now}
      ) AS locked
    `;
    return rows[0]?.locked === true;
  }

  public async recordFailure(email: string, now: Date): Promise<void> {
    const hash = this.hashEmail(email);
    await this.clientFactory().$executeRaw`
      INSERT INTO auth_login_attempts (email_hash, failures, locked_until, updated_at)
      VALUES (${hash}, 1, NULL, ${now})
      ON CONFLICT (email_hash) DO UPDATE SET
        failures = auth_login_attempts.failures + 1,
        locked_until = CASE
          WHEN auth_login_attempts.locked_until > ${now} THEN auth_login_attempts.locked_until
          WHEN auth_login_attempts.failures + 1 >= 5 THEN ${now}::timestamptz +
            make_interval(mins => LEAST(60, 5 * (auth_login_attempts.failures - 3)))
          ELSE NULL
        END,
        updated_at = ${now}
    `;
  }

  public async clear(email: string): Promise<void> {
    await this.clientFactory().$executeRaw`
      DELETE FROM auth_login_attempts WHERE email_hash = ${this.hashEmail(email)}
    `;
  }

  private hashEmail(email: string): Buffer {
    const key = Buffer.from(this.keyFactory(), 'base64url');
    if (key.length < 32)
      throw new Error('Login attempt HMAC key is missing or too short.');
    return createHmac('sha256', key)
      .update('login-attempt:', 'utf8')
      .update(email.trim().toLowerCase(), 'utf8')
      .digest();
  }
}
