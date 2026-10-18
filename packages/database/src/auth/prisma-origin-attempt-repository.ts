import { createHmac, randomUUID } from 'node:crypto';

import type {
  LoginOriginAttemptRepository,
  RecoveryOriginAttemptRepository,
} from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaOriginAttemptRepository
  implements LoginOriginAttemptRepository, RecoveryOriginAttemptRepository
{
  public constructor(
    private readonly clientFactory: () => PrismaClient,
    private readonly keyFactory: () => string,
  ) {}

  public async reserve(origin: string, now: Date): Promise<string | null> {
    const hash = this.hash(origin);
    return this.clientFactory().$transaction(
      async (transaction): Promise<string | null> => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${hash.readBigInt64BE(0)})::text`;
        await transaction.$executeRaw`DELETE FROM auth_origin_login_reservations
          WHERE origin_hash = ${hash} AND expires_at < ${new Date(now.getTime() - 86_400_000)}`;
        const rows = await transaction.$queryRaw<
          readonly { locked: boolean; pending: bigint; attempts: number }[]
        >`
          SELECT EXISTS (SELECT 1 FROM auth_origin_attempts WHERE origin_hash = ${hash}
            AND purpose = 'login' AND locked_until > ${now}) AS locked,
            COALESCE((SELECT attempts FROM auth_origin_attempts WHERE origin_hash = ${hash}
              AND purpose = 'login'), 0) AS attempts,
            (SELECT COUNT(*) FROM auth_origin_login_reservations
              WHERE origin_hash = ${hash} AND expires_at > ${now}) AS pending`;
        const attempts = rows[0]?.attempts ?? 0;
        if (
          rows[0]?.locked ||
          Number(rows[0]?.pending ?? 0n) >= Math.max(1, 5 - attempts)
        )
          return null;
        const id = randomUUID();
        await transaction.$executeRaw`INSERT INTO auth_origin_login_reservations (id, origin_hash, expires_at)
          VALUES (${id}::uuid, ${hash}, ${new Date(now.getTime() + 600_000)})`;
        return id;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  public async finish(
    origin: string,
    reservation: string,
    failed: boolean,
    now: Date,
  ): Promise<void> {
    const hash = this.hash(origin);
    await this.clientFactory().$transaction(
      async (transaction): Promise<void> => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${hash.readBigInt64BE(0)})::text`;
        const deleted =
          await transaction.$executeRaw`DELETE FROM auth_origin_login_reservations
        WHERE id = ${reservation}::uuid AND origin_hash = ${hash}`;
        if (!failed || deleted === 0) return;
        await transaction.$executeRaw`
        INSERT INTO auth_origin_attempts (origin_hash, purpose, attempts, locked_until, updated_at)
        VALUES (${hash}, 'login', 1, NULL, ${now})
        ON CONFLICT (origin_hash, purpose) DO UPDATE SET
          attempts = auth_origin_attempts.attempts + 1,
          locked_until = CASE
            WHEN auth_origin_attempts.locked_until > ${now} THEN auth_origin_attempts.locked_until
            WHEN auth_origin_attempts.attempts + 1 >= 5
              THEN ${now}::timestamptz + make_interval(mins => LEAST(60, 5 * (auth_origin_attempts.attempts - 3)))
            ELSE NULL END,
          updated_at = ${now}`;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  public async allowAndRecord(origin: string, now: Date): Promise<boolean> {
    const hash = this.hash(origin);
    return this.clientFactory().$transaction(
      async (transaction): Promise<boolean> => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${hash.readBigInt64BE(0)})::text`;
        const rows = await transaction.$queryRaw<
          readonly { locked: boolean }[]
        >`
        SELECT EXISTS (SELECT 1 FROM auth_origin_attempts
          WHERE origin_hash = ${hash} AND purpose = 'recovery' AND locked_until > ${now}) AS locked`;
        if (rows[0]?.locked) return false;
        await transaction.$executeRaw`
        INSERT INTO auth_origin_attempts (origin_hash, purpose, attempts, locked_until, updated_at)
        VALUES (${hash}, 'recovery', 1, NULL, ${now})
        ON CONFLICT (origin_hash, purpose) DO UPDATE SET
          attempts = auth_origin_attempts.attempts + 1,
          locked_until = CASE WHEN auth_origin_attempts.attempts + 1 >= 5
            THEN ${now}::timestamptz + make_interval(mins => LEAST(60, 5 * (auth_origin_attempts.attempts - 3)))
            ELSE NULL END,
          updated_at = ${now}`;
        return true;
      },
      { maxWait: 30_000, timeout: 30_000 },
    );
  }

  public async pruneOlderThan(cutoff: Date): Promise<number> {
    const reservations = await this.clientFactory().$executeRaw`
      DELETE FROM auth_origin_login_reservations WHERE expires_at < ${cutoff}`;
    const attempts = await this.clientFactory().$executeRaw`
      DELETE FROM auth_origin_attempts
      WHERE updated_at < ${cutoff} AND (locked_until IS NULL OR locked_until < ${cutoff})`;
    return reservations + attempts;
  }

  private hash(origin: string): Buffer {
    const key = Buffer.from(this.keyFactory(), 'base64url');
    if (key.length < 32)
      throw new Error('Origin attempt HMAC key is missing or too short.');
    return createHmac('sha256', key)
      .update('auth-origin:', 'utf8')
      .update(origin, 'utf8')
      .digest();
  }
}
