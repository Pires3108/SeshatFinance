import { createHash } from 'node:crypto';

import {
  IdempotencyConflictError,
  idempotencyExpiresAt,
  type IdempotencyRequest,
} from '@seshat/application';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;

/** SHA-256 of the normalized payload with keys in a stable order. */
export function idempotencyPayloadHash(
  payload: IdempotencyRequest['payload'],
): string {
  const canonical = JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key]]),
  );
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Returns the stored response for an unexpired key with the same payload hash,
 * null for an unused or expired key, and throws IdempotencyConflictError when
 * the payload differs.
 */
export async function findActiveIdempotentResponse(
  client: QueryClient,
  request: IdempotencyRequest,
): Promise<string | null> {
  const record = await client.idempotencyRecord.findUnique({
    where: {
      ownerId_operation_key: {
        key: request.key,
        operation: request.operation,
        ownerId: request.ownerId,
      },
    },
  });
  if (record === null || record.expiresAt <= request.requestedAt) return null;
  if (record.payloadHash !== idempotencyPayloadHash(request.payload)) {
    throw new IdempotencyConflictError();
  }
  return record.response;
}

/**
 * Claims the key inside the caller's database transaction. A concurrent
 * request holding the same key is rejected without waiting, so only one
 * financial write can proceed. Returns the stored response when an identical
 * request already committed.
 */
export async function claimIdempotencyKey(
  client: Prisma.TransactionClient,
  request: IdempotencyRequest,
): Promise<string | null> {
  const lockName = `${request.ownerId}:${request.operation}:${request.key}`;
  const [lock] = await client.$queryRaw<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${lockName}, 35)) AS acquired
  `;
  if (lock?.acquired !== true) throw new IdempotencyConflictError();
  return findActiveIdempotentResponse(client, request);
}

/** Stores the response, replacing an expired record for the same key. */
export async function storeIdempotentResponse(
  client: Prisma.TransactionClient,
  request: IdempotencyRequest,
  response: string,
): Promise<void> {
  const data = {
    createdAt: request.requestedAt,
    expiresAt: idempotencyExpiresAt(request.requestedAt),
    payloadHash: idempotencyPayloadHash(request.payload),
    response,
  };
  await client.idempotencyRecord.upsert({
    create: {
      ...data,
      key: request.key,
      operation: request.operation,
      ownerId: request.ownerId,
    },
    update: data,
    where: {
      ownerId_operation_key: {
        key: request.key,
        operation: request.operation,
        ownerId: request.ownerId,
      },
    },
  });
}

/** Removes records whose replay window has ended. */
export async function deleteExpiredIdempotencyRecords(
  client: QueryClient,
  now: Date,
  limit: number,
): Promise<number> {
  return client.$executeRaw`
    DELETE FROM "idempotency_records"
    WHERE ctid IN (
      SELECT ctid FROM "idempotency_records"
      WHERE "expires_at" <= ${now}
      ORDER BY "expires_at"
      LIMIT ${limit}
    )
  `;
}
