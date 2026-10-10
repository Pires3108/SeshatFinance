import { createHmac } from 'node:crypto';

import type {
  LoginAttemptRepository,
  LoginAttemptState,
} from '@seshat/application';
import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaLoginAttemptRepository implements LoginAttemptRepository {
  public constructor(
    private readonly clientFactory: () => PrismaClient,
    private readonly keyFactory: () => string,
  ) {}

  public runExclusive<T>(
    email: string,
    action: (state: LoginAttemptState) => Promise<T>,
  ): Promise<T> {
    const hash = this.hashEmail(email);
    const lockKey = hash.readBigInt64BE(0);
    return this.clientFactory().$transaction(
      async (transaction): Promise<T> => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(${lockKey})::text AS lock_acquired
        `;
        const state: LoginAttemptState = {
          isLocked: async (now): Promise<boolean> => {
            const rows = await transaction.$queryRaw<
              readonly { locked: boolean }[]
            >`
      SELECT EXISTS (
        SELECT 1 FROM auth_login_attempts
        WHERE email_hash = ${hash} AND locked_until > ${now}
      ) AS locked
    `;
            return rows[0]?.locked === true;
          },
          recordFailure: async (now): Promise<void> => {
            await transaction.$executeRaw`
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
          },
          clear: async (): Promise<void> => {
            await transaction.$executeRaw`
              DELETE FROM auth_login_attempts WHERE email_hash = ${hash}
            `;
          },
        };
        return action(state);
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
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
