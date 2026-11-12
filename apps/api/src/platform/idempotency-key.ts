import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from '@seshat/application';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ApiHeaderOptions } from '@nestjs/swagger';
import { z } from 'zod';

const idempotencyKeySchema = z.uuidv4();

/** OpenAPI description shared by commands that require an Idempotency-Key. */
export const idempotencyKeyHeader: ApiHeaderOptions = {
  description:
    'UUID v4 unique per user and operation. An identical repetition within 24 hours returns the original response; a different payload or a concurrent repetition returns 409.',
  name: 'Idempotency-Key',
  required: true,
  schema: { format: 'uuid', type: 'string' },
};

export function parseIdempotencyKeyHeader(value: unknown): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException('Invalid idempotency key.');
  }
  return parsed.data;
}

/** Maps generic idempotency errors, returning undefined for other errors. */
export function mapIdempotencyError(error: unknown): Error | undefined {
  if (error instanceof InvalidIdempotencyKeyError) {
    return new BadRequestException('Invalid idempotency key.');
  }
  if (error instanceof IdempotencyConflictError) {
    return new ConflictException(
      'Idempotency key conflicts with another request.',
    );
  }
  return undefined;
}
