import { createHmac } from 'node:crypto';

import type {
  AuthenticationAttempt,
  AuthenticationAttemptRepository,
  AuthenticationAttemptResult,
} from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

type AttemptState = Readonly<{
  failedAttempts: number;
  lockoutCount: number;
  lockedUntil: Date | null;
}>;

const FAILURE_LIMIT = 5;
const INITIAL_LOCKOUT_MS = 5 * 60_000;
const MAX_LOCKOUT_COUNT = 5;

export class PrismaAuthenticationAttemptRepository implements AuthenticationAttemptRepository {
  public constructor(
    private readonly client: PrismaClient,
    private readonly hmacKey: string,
  ) {
    if (hmacKey.length < 32)
      throw new Error('Authentication attempt HMAC key is not configured.');
  }

  public async execute(
    normalizedEmail: string,
    now: Date,
    authenticate: () => Promise<AuthenticationAttempt>,
  ): Promise<AuthenticationAttemptResult> {
    const identityHash = createHmac('sha256', this.hmacKey)
      .update(normalizedEmail, 'utf8')
      .digest('hex');

    return this.client.$transaction(
      async (transaction): Promise<AuthenticationAttemptResult> => {
        await transaction.$executeRaw`
          INSERT INTO authentication_attempt_limits
            (identity_hash, failed_attempts, lockout_count, updated_at)
          VALUES (${identityHash}, 0, 0, ${now})
          ON CONFLICT (identity_hash) DO NOTHING
        `;
        const [state] = await transaction.$queryRaw<AttemptState[]>`
          SELECT
            failed_attempts AS "failedAttempts",
            lockout_count AS "lockoutCount",
            locked_until AS "lockedUntil"
          FROM authentication_attempt_limits
          WHERE identity_hash = ${identityHash}
          FOR UPDATE
        `;
        if (state === undefined)
          throw new Error('Authentication attempt state is unavailable.');
        if (state.lockedUntil !== null && state.lockedUntil > now)
          return { kind: 'blocked' };

        const result = await authenticate();
        if (result.kind === 'accepted') {
          await transaction.authenticationAttemptLimit.delete({
            where: { identityHash },
          });
          return result;
        }
        if (result.kind === 'unavailable') return result;

        const failures =
          state.lockedUntil !== null ? 1 : state.failedAttempts + 1;
        const lockoutCount =
          failures === FAILURE_LIMIT
            ? Math.min(state.lockoutCount + 1, MAX_LOCKOUT_COUNT)
            : state.lockoutCount;
        const lockedUntil =
          failures === FAILURE_LIMIT
            ? new Date(
                now.getTime() + INITIAL_LOCKOUT_MS * 2 ** (lockoutCount - 1),
              )
            : null;
        await transaction.authenticationAttemptLimit.update({
          where: { identityHash },
          data: {
            failedAttempts: failures === FAILURE_LIMIT ? 0 : failures,
            lockoutCount,
            lockedUntil,
            updatedAt: now,
          },
        });
        return result;
      },
      { maxWait: 15_000, timeout: 20_000 },
    );
  }
}
