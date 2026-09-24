import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { FamilyGroup, FamilyGroupMembership } from '@seshat/domain';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient } from '../prisma/create-prisma-client.js';
import { PrismaFamilyGroupRepository } from './prisma-family-group-repository.js';

describe('PrismaFamilyGroupRepository', () => {
  let disconnect: (() => Promise<void>) | undefined;
  let prisma: PrismaClient | undefined;
  let repository: PrismaFamilyGroupRepository | undefined;
  let stop: (() => Promise<void>) | undefined;

  beforeAll(async (): Promise<void> => {
    const container = await new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('seshat_test')
      .withUsername('seshat_test')
      .withPassword('synthetic-test-password')
      .start();
    stop = async (): Promise<void> => container.stop().then(() => undefined);
    const migrationClient = new Client({
      connectionString: container.getConnectionUri(),
    });
    await migrationClient.connect();
    await migrationClient.query(
      await readFile(
        new URL(
          '../../prisma/migrations/20260924090000_create_family_groups/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await migrationClient.end();
    prisma = createPrismaClient(container.getConnectionUri());
    disconnect = async (): Promise<void> => prisma?.$disconnect();
    repository = new PrismaFamilyGroupRepository(prisma);
  }, 60_000);

  afterAll(async (): Promise<void> => {
    await disconnect?.();
    await stop?.();
  });

  it('persists a group and its owner together, isolated and ordered by membership', async () => {
    if (repository === undefined || prisma === undefined) {
      throw new Error('Family group persistence is unavailable.');
    }
    const first = group(
      '11111111-1111-4111-8111-111111111111',
      '2026-09-24T10:00:00.000Z',
    );
    const second = group(
      '22222222-2222-4222-8222-222222222222',
      '2026-09-24T11:00:00.000Z',
    );
    await repository.insert(first.group, first.owner);
    await repository.insert(second.group, second.owner);

    await expect(repository.listForMember(ownerId)).resolves.toEqual([
      first.owner.toSnapshot(),
      second.owner.toSnapshot(),
    ]);
    await expect(repository.listForMember(otherUserId)).resolves.toEqual([]);
    await expect(prisma.familyGroup.count()).resolves.toBe(2);
    await expect(prisma.familyGroupMembership.count()).resolves.toBe(2);
  });

  it('enforces the single-owner and membership foreign-key constraints', async () => {
    if (prisma === undefined) {
      throw new Error('Family group persistence is unavailable.');
    }
    await expect(
      prisma.familyGroupMembership.create({
        data: {
          groupId: '11111111-1111-4111-8111-111111111111',
          joinedAt: new Date('2026-09-24T12:00:00.000Z'),
          role: 'owner',
          userId: otherUserId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.familyGroupMembership.create({
        data: {
          groupId: '33333333-3333-4333-8333-333333333333',
          joinedAt: new Date('2026-09-24T12:00:00.000Z'),
          role: 'member',
          userId: otherUserId,
        },
      }),
    ).rejects.toThrow();
  });
});

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function group(
  id: string,
  at: string,
): {
  group: FamilyGroup;
  owner: FamilyGroupMembership;
} {
  const createdAt = new Date(at);
  const value = FamilyGroup.create({ createdAt, id });
  return {
    group: value,
    owner: FamilyGroupMembership.createOwner({
      groupId: value.id,
      joinedAt: createdAt,
      userId: ownerId,
    }),
  };
}
