import { createHmac } from 'node:crypto';

import type { RecoveryRequestAttemptRepository } from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaRecoveryRequestAttemptRepository implements RecoveryRequestAttemptRepository {
  public constructor(
    private readonly clientFactory: () => PrismaClient,
    private readonly keyFactory: () => string,
  ) {}

  public allowAndRecord(email: string, now: Date): Promise<boolean> {
    const hash = this.hashEmail(email);
    const lockKey = hash.readBigInt64BE(0);
    return this.clientFactory().$transaction(
      async (transaction): Promise<boolean> => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(${lockKey})::text AS lock_acquired
        `;
        const rows = await transaction.$queryRaw<
          readonly { locked: boolean }[]
        >`
          SELECT EXISTS (
            SELECT 1 FROM auth_recovery_request_attempts
            WHERE email_hash = ${hash} AND locked_until > ${now}
          ) AS locked
        `;
        if (rows[0]?.locked === true) return false;
        await transaction.$executeRaw`
          INSERT INTO auth_recovery_request_attempts
            (email_hash, requests, locked_until, updated_at)
          VALUES (${hash}, 1, NULL, ${now})
          ON CONFLICT (email_hash) DO UPDATE SET
            requests = auth_recovery_request_attempts.requests + 1,
            locked_until = CASE
              WHEN auth_recovery_request_attempts.requests + 1 >= 5
              THEN ${now}::timestamptz + make_interval(
                mins => LEAST(60, 5 * (auth_recovery_request_attempts.requests - 3))
              )
              ELSE NULL
            END,
            updated_at = ${now}
        `;
        return true;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  public async pruneOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.clientFactory().$executeRaw`
      DELETE FROM auth_recovery_request_attempts
      WHERE updated_at < ${cutoff} AND (locked_until IS NULL OR locked_until < ${cutoff})
    `;
    return deleted;
  }

  private hashEmail(email: string): Buffer {
    const key = Buffer.from(this.keyFactory(), 'base64url');
    if (key.length < 32)
      throw new Error('Recovery request HMAC key is missing or too short.');
    return createHmac('sha256', key)
      .update('recovery-request:', 'utf8')
      .update(email.trim().toLowerCase(), 'utf8')
      .digest();
  }
}
