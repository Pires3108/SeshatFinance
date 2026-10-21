import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaConfirmedIdentityProfileRepository } from './prisma-confirmed-identity-profile-repository.js';

describe('registration intent HMAC', () => {
  it('matches deterministically with one key and cannot be reproduced with another', async () => {
    const hashes: Buffer[] = [];
    const client = {
      $executeRaw: vi.fn(
        (_sql: TemplateStringsArray, hash: Buffer): Promise<number> => {
          hashes.push(hash);
          return Promise.resolve(1);
        },
      ),
    } as unknown as PrismaClient;
    const firstKey = Buffer.alloc(32, 7).toString('base64url');
    const secondKey = Buffer.alloc(32, 8).toString('base64url');
    await new PrismaConfirmedIdentityProfileRepository(
      () => client,
      () => firstKey,
    ).recordIntent('PERSON@example.test');
    await new PrismaConfirmedIdentityProfileRepository(
      () => client,
      () => firstKey,
    ).recordIntent('person@example.test');
    await new PrismaConfirmedIdentityProfileRepository(
      () => client,
      () => secondKey,
    ).recordIntent('person@example.test');
    expect(hashes[0]).toEqual(hashes[1]);
    expect(hashes[2]).not.toEqual(hashes[0]);
    expect(hashes[0]?.toString('utf8')).not.toContain('person@example.test');
  });

  it('fails closed without a full-size server key', async () => {
    const execute = vi.fn();
    const repository = new PrismaConfirmedIdentityProfileRepository(
      () => ({ $executeRaw: execute }) as unknown as PrismaClient,
      () => 'missing',
    );
    await expect(
      repository.recordIntent('person@example.test'),
    ).rejects.toThrow('HMAC key');
    expect(execute).not.toHaveBeenCalled();
  });
});
