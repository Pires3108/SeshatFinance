import { describe, expect, it } from 'vitest';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import {
  GetOwnUserProfileUseCase,
  TimeZoneChangeScopeRequiredError,
  UpdateOwnUserProfileUseCase,
  UserProfileVersionConflictError,
  type UserProfile,
  type UserProfileRepository,
  type UserTimeZoneChange,
} from './update-own-user-profile.js';

class RecordingUserProfileRepository implements UserProfileRepository {
  public savedProfile: UserProfile | undefined;
  public upserts = 0;
  public changes: UserTimeZoneChange[] = [];
  public expectedVersions: number[] = [];
  public conflict = false;

  public findById(id: string): Promise<UserProfile | null> {
    return Promise.resolve(
      this.savedProfile?.id === id ? this.savedProfile : null,
    );
  }

  public upsert(profile: UserProfile): Promise<UserProfile> {
    this.upserts += 1;
    this.savedProfile = profile;
    return Promise.resolve(profile);
  }

  public changeTimeZone(
    profile: UserProfile,
    expectedVersion: number,
    change: UserTimeZoneChange,
  ): Promise<UserProfile | null> {
    if (this.conflict) return Promise.resolve(null);
    this.expectedVersions.push(expectedVersion);
    this.changes.push(change);
    this.savedProfile = { ...profile, version: expectedVersion + 1 };
    return Promise.resolve(this.savedProfile);
  }
}

const instant = new Date('2026-09-19T21:00:00.000Z');
const clock: Clock = { now: (): Date => new Date(instant) };
const identifiers: IdentifierGenerator = {
  generate: (): string => 'change-id',
};
const actorId = '7c2c7a54-73fe-49a3-b0ea-19034bf22baf';
const baseCommand = {
  actorId,
  displayName: 'Nicolas',
  locale: 'pt-BR',
  timeZone: 'America/Sao_Paulo',
  presentationCurrency: 'BRL',
};

function setup(): {
  repository: RecordingUserProfileRepository;
  useCase: UpdateOwnUserProfileUseCase;
} {
  const repository = new RecordingUserProfileRepository();
  return {
    repository,
    useCase: new UpdateOwnUserProfileUseCase(repository, clock, identifiers),
  };
}

describe('UpdateOwnUserProfileUseCase', () => {
  it('scopes the profile to the authenticated actor and injected time', async (): Promise<void> => {
    const { repository, useCase } = setup();

    const result = await useCase.execute(baseCommand);

    expect(result.id).toBe(actorId);
    expect(repository.savedProfile?.updatedAt).toEqual(instant);
    expect(result.refundPresentation).toBe('separate-income');
    const updated = await useCase.execute({
      actorId: result.id,
      displayName: 'Nicolas',
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
      presentationCurrency: 'BRL',
      refundPresentation: 'expense-offset',
    });
    expect(updated.refundPresentation).toBe('expense-offset');
    const preserved = await useCase.execute({
      actorId: result.id,
      displayName: 'Nicolas',
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
      presentationCurrency: 'BRL',
    });
    expect(preserved.refundPresentation).toBe('expense-offset');
  });

  it.each([
    {
      locale: 'en-US',
      presentationCurrency: 'BRL',
      timeZone: 'America/Sao_Paulo',
    },
    {
      locale: 'pt-BR',
      presentationCurrency: 'USD',
      timeZone: 'America/Sao_Paulo',
    },
    { locale: 'pt-BR', presentationCurrency: 'BRL', timeZone: 'Invalid/Zone' },
    { locale: 'pt-BR', presentationCurrency: 'BRL', timeZone: '+03:00' },
  ])(
    'rejects unsupported preferences before persistence',
    async (preferences): Promise<void> => {
      const { repository, useCase } = setup();
      await expect(
        useCase.execute({
          actorId: 'actor-id',
          displayName: null,
          ...preferences,
        }),
      ).rejects.toThrow();
      expect(repository.savedProfile).toBeUndefined();
    },
  );

  it('creates a first profile without requiring a change scope', async (): Promise<void> => {
    const { repository, useCase } = setup();

    await useCase.execute({ ...baseCommand, timeZone: 'Asia/Tokyo' });

    expect(repository.upserts).toBe(1);
    expect(repository.changes).toEqual([]);
  });

  it('requires an explicit scope and persists nothing without it', async (): Promise<void> => {
    const { repository, useCase } = setup();
    await useCase.execute(baseCommand);

    await expect(
      useCase.execute({ ...baseCommand, timeZone: 'Asia/Tokyo' }),
    ).rejects.toBeInstanceOf(TimeZoneChangeScopeRequiredError);

    expect(repository.changes).toEqual([]);
    expect(repository.savedProfile?.timeZone).toBe('America/Sao_Paulo');
  });

  it.each(['reinterpret_existing', 'new_items_only'] as const)(
    'records the previous zone, new zone, and %s scope',
    async (scope): Promise<void> => {
      const { repository, useCase } = setup();
      await useCase.execute(baseCommand);

      const result = await useCase.execute({
        ...baseCommand,
        timeZone: 'Asia/Tokyo',
        timeZoneChangeScope: scope,
      });

      expect(result.timeZone).toBe('Asia/Tokyo');
      expect(repository.expectedVersions).toEqual([1]);
      expect(repository.changes).toEqual([
        {
          id: 'change-id',
          ownerId: actorId,
          previousTimeZone: 'America/Sao_Paulo',
          newTimeZone: 'Asia/Tokyo',
          scope,
          changedAt: instant,
        },
      ]);
    },
  );

  it('treats a repeated request for the current zone as idempotent', async (): Promise<void> => {
    const { repository, useCase } = setup();
    await useCase.execute(baseCommand);
    const command = {
      ...baseCommand,
      timeZone: 'Asia/Tokyo',
      timeZoneChangeScope: 'new_items_only',
    } as const;

    await useCase.execute(command);
    await useCase.execute(command);

    expect(repository.changes).toHaveLength(1);
  });

  it('reports a concurrent profile change as a conflict', async (): Promise<void> => {
    const { repository, useCase } = setup();
    await useCase.execute(baseCommand);
    repository.conflict = true;

    await expect(
      useCase.execute({
        ...baseCommand,
        timeZone: 'Asia/Tokyo',
        timeZoneChangeScope: 'new_items_only',
      }),
    ).rejects.toBeInstanceOf(UserProfileVersionConflictError);
  });
});

describe('GetOwnUserProfileUseCase', () => {
  it('queries only the authenticated actor profile', async (): Promise<void> => {
    const repository = new RecordingUserProfileRepository();
    const useCase = new GetOwnUserProfileUseCase(repository);

    await expect(useCase.execute('actor-id')).resolves.toBeNull();
  });
});
