import type { UserProfile, UserProfileRepository } from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaUserProfileRepository implements UserProfileRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async findById(id: string): Promise<UserProfile | null> {
    const persisted = await this.client.userProfile.findUnique({
      where: { id },
    });
    return persisted === null ? null : mapProfile(persisted);
  }

  public async upsert(profile: UserProfile): Promise<UserProfile> {
    const persisted = await this.client.userProfile.upsert({
      where: { id: profile.id },
      create: {
        id: profile.id,
        displayName: profile.displayName,
        locale: profile.locale,
        timeZone: profile.timeZone,
        presentationCurrency: profile.presentationCurrency,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      update: {
        displayName: profile.displayName,
        locale: profile.locale,
        timeZone: profile.timeZone,
        presentationCurrency: profile.presentationCurrency,
        updatedAt: profile.updatedAt,
        version: { increment: 1 },
      },
    });

    return mapProfile(persisted);
  }
}

function mapProfile(persisted: UserProfile): UserProfile {
  return {
    id: persisted.id,
    displayName: persisted.displayName,
    locale: persisted.locale,
    timeZone: persisted.timeZone,
    presentationCurrency: persisted.presentationCurrency,
    createdAt: persisted.createdAt,
    updatedAt: persisted.updatedAt,
    version: persisted.version,
  };
}
