/** Retention window for replaying an idempotent command response (RII-017). */
export const IDEMPOTENCY_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1000;

export type IdempotencyPayloadValue = string | number | boolean | null;

/**
 * Identifies one idempotent command execution. The payload must already be
 * normalized so that equivalent requests produce identical values.
 */
export type IdempotencyRequest = Readonly<{
  key: string;
  operation: string;
  ownerId: string;
  payload: Readonly<Record<string, IdempotencyPayloadValue>>;
  requestedAt: Date;
}>;

export class InvalidIdempotencyKeyError extends Error {
  public constructor() {
    super('A UUID v4 idempotency key is required.');
    this.name = 'InvalidIdempotencyKeyError';
  }
}

/**
 * The key was reused with a different payload, or another request with the
 * same key is still being processed.
 */
export class IdempotencyConflictError extends Error {
  public constructor() {
    super('Idempotency key conflicts with another request.');
    this.name = 'IdempotencyConflictError';
  }
}

const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Validates a UUID v4 idempotency key and returns its canonical form. */
export function normalizeIdempotencyKey(key: string): string {
  if (!uuidV4.test(key)) throw new InvalidIdempotencyKeyError();
  return key.toLowerCase();
}

export function idempotencyExpiresAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + IDEMPOTENCY_RETENTION_MILLISECONDS);
}
