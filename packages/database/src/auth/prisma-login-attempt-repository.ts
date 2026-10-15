import { createHmac, randomUUID } from 'node:crypto';

import type {
  LoginAttemptRepository,
  LoginAttemptState,
} from '@seshat/application';
import type { PrismaClient } from '../generated/prisma/client.js';

const WAIT_MS = 30_000;

export class PrismaLoginAttemptRepository implements LoginAttemptRepository {
  public constructor(
    private readonly clientFactory: () => PrismaClient,
    private readonly keyFactory: () => string,
  ) {}

  public async runExclusive<T>(
    email: string,
    action: (state: LoginAttemptState) => Promise<T>,
  ): Promise<T> {
    const hash = this.hashEmail(email);
    const holder = randomUUID();
    const deadline = Date.now() + WAIT_MS;
    let acquired = false;
    while (!acquired) {
      const rows = await this.clientFactory().$executeRaw`
        INSERT INTO auth_login_leases (email_hash, holder, expires_at)
        VALUES (${hash}, ${holder}::uuid, NOW() + INTERVAL '10 minutes')
        ON CONFLICT (email_hash) DO UPDATE
          SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
          WHERE auth_login_leases.expires_at <= NOW()`;
      acquired = rows === 1;
      if (!acquired) {
        if (Date.now() >= deadline) throw new Error('Login lock unavailable.');
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    }

    const heartbeat = setInterval(() => {
      void this.clientFactory().$executeRaw`
        UPDATE auth_login_leases SET expires_at = NOW() + INTERVAL '10 minutes'
        WHERE email_hash = ${hash} AND holder = ${holder}::uuid
      `.catch(() => undefined);
    }, 60_000);
    heartbeat.unref();
    try {
      const state: LoginAttemptState = {
        isLocked: async (now): Promise<boolean> => {
          const rows = await this.clientFactory().$queryRaw<
            readonly { locked: boolean }[]
          >`
            SELECT EXISTS (SELECT 1 FROM auth_login_attempts
              WHERE email_hash = ${hash} AND locked_until > ${now}) AS locked`;
          return rows[0]?.locked === true;
        },
        recordFailure: async (now): Promise<void> => {
          await this.clientFactory().$executeRaw`
            INSERT INTO auth_login_attempts (email_hash, failures, locked_until, updated_at)
            VALUES (${hash}, 1, NULL, ${now})
            ON CONFLICT (email_hash) DO UPDATE SET
              failures = auth_login_attempts.failures + 1,
              locked_until = CASE
                WHEN auth_login_attempts.locked_until > ${now} THEN auth_login_attempts.locked_until
                WHEN auth_login_attempts.failures + 1 >= 5 THEN ${now}::timestamptz +
                  make_interval(mins => LEAST(60, 5 * (auth_login_attempts.failures - 3)))
                ELSE NULL END,
              updated_at = ${now}`;
        },
        clear: async (): Promise<void> => {
          await this.clientFactory().$executeRaw`
            DELETE FROM auth_login_attempts WHERE email_hash = ${hash}`;
        },
      };
      return await action(state);
    } finally {
      clearInterval(heartbeat);
      await this.clientFactory().$executeRaw`
        DELETE FROM auth_login_leases WHERE email_hash = ${hash} AND holder = ${holder}::uuid`;
    }
  }

  public pruneExpired(): Promise<number> {
    return this.clientFactory().$executeRaw`
      DELETE FROM auth_login_leases WHERE expires_at < NOW()`;
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
