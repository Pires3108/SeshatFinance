import { describe, expect, it } from 'vitest';

import type { Clock } from '../ports/clock.js';
import {
  GetOwnUserProfileUseCase,
  UpdateOwnUserProfileUseCase,
  type UserProfile,
  type UserProfileRepository,
} from './update-own-user-profile.js';

class RecordingUserProfileRepository implements UserProfileRepository {
  public savedProfile: UserProfile | undefined;

  public findById(id: string): Promise<UserProfile | null> {
    return Promise.resolve(
      this.savedProfile?.id === id ? this.savedProfile : null,
    );
  }

  public upsert(profile: UserProfile): Promise<UserProfile> {
    this.savedProfile = profile;
    return Promise.resolve(profile);
  }
}

describe('UpdateOwnUserProfileUseCase', () => {
  it('scopes the profile to the authenticated actor and injected time', async (): Promise<void> => {
    const repository = new RecordingUserProfileRepository();
    const instant = new Date('2026-09-19T21:00:00.000Z');
    const clock: Clock = { now: (): Date => new Date(instant) };
    const useCase = new UpdateOwnUserProfileUseCase(repository, clock);

    const result = await useCase.execute({
      actorId: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
      displayName: 'Nicolas',
      locale: 'pt-BR',
      timeZone: 'America/Sao_Paulo',
      presentationCurrency: 'BRL',
    });

    expect(result.id).toBe('7c2c7a54-73fe-49a3-b0ea-19034bf22baf');
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
});

describe('GetOwnUserProfileUseCase', () => {
  it('queries only the authenticated actor profile', async (): Promise<void> => {
    const repository = new RecordingUserProfileRepository();
    const useCase = new GetOwnUserProfileUseCase(repository);

    await expect(useCase.execute('actor-id')).resolves.toBeNull();
  });
});
