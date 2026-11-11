import type {
  UserProfile,
  UserProfileRepository,
  UserTimeZoneChange,
} from '@seshat/application';

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
        presentationCurrency: profile.presentationCurrency,
        updatedAt: profile.updatedAt,
        version: { increment: 1 },
      },
    });

    return mapProfile(persisted);
  }

  public changeTimeZone(
    profile: UserProfile,
    expectedVersion: number,
    change: UserTimeZoneChange,
  ): Promise<UserProfile | null> {
    return this.client.$transaction(async (client) => {
      const updated = await client.userProfile.updateMany({
        where: { id: profile.id, version: expectedVersion },
        data: {
          displayName: profile.displayName,
          locale: profile.locale,
          timeZone: change.newTimeZone,
          presentationCurrency: profile.presentationCurrency,
          updatedAt: profile.updatedAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      const reinterpreted =
        change.scope === 'reinterpret_existing'
          ? await client.transaction.updateMany({
              where: { ownerId: change.ownerId },
              data: { timeZone: change.newTimeZone },
            })
          : { count: 0 };
      await client.userTimeZoneChange.create({
        data: {
          id: change.id,
          ownerId: change.ownerId,
          previousTimeZone: change.previousTimeZone,
          newTimeZone: change.newTimeZone,
          scope: change.scope,
          affectedTransactions: reinterpreted.count,
          changedAt: change.changedAt,
        },
      });
      return mapProfile(
        await client.userProfile.findUniqueOrThrow({
          where: { id: profile.id },
        }),
      );
    });
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
