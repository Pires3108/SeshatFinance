import { createHmac } from 'node:crypto';

import type {
  ConfirmedIdentityProfileRepository,
  ConfirmedRegistrationIdentity,
  PendingRegistrationProfileRepository,
} from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaConfirmedIdentityProfileRepository
  implements
    ConfirmedIdentityProfileRepository,
    PendingRegistrationProfileRepository
{
  public constructor(
    private readonly clientFactory: () => PrismaClient,
    private readonly keyFactory: () => string,
  ) {}

  public async ensure(
    identity: ConfirmedRegistrationIdentity,
    confirmedAt: Date,
  ): Promise<void> {
    const emailHash = this.hashEmail(identity.email);
    await this.clientFactory().$transaction(
      async (transaction): Promise<void> => {
        await transaction.$executeRaw`
        INSERT INTO user_profiles (id, display_name, registration_confirmed, created_at, updated_at)
        SELECT ${identity.id}::uuid, ${identity.displayName}, true, ${confirmedAt}, ${confirmedAt}
        FROM registration_intents WHERE email_hash = ${emailHash} AND expires_at > ${confirmedAt}
        ON CONFLICT (id) DO UPDATE SET registration_confirmed = true, updated_at = ${confirmedAt}
      `;
        const rows = await transaction.$queryRaw<
          readonly { exists: boolean }[]
        >`
        SELECT EXISTS(
          SELECT 1 FROM user_profiles
          WHERE id = ${identity.id}::uuid AND registration_confirmed = true
        ) AS exists
      `;
        if (rows[0]?.exists !== true)
          throw new Error(
            'Confirmed identity has no local registration intent.',
          );
        await transaction.$executeRaw`
        DELETE FROM registration_intents WHERE email_hash = ${emailHash}
      `;
      },
    );
  }

  public async ready(): Promise<void> {
    await this.clientFactory().$queryRaw`SELECT 1`;
  }

  public async createPending(id: string, displayName: string): Promise<void> {
    await this.clientFactory().$executeRaw`
      INSERT INTO user_profiles (id, display_name, registration_confirmed, updated_at)
      VALUES (${id}::uuid, ${displayName}, false, now())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  public async recordIntent(email: string): Promise<void> {
    const emailHash = this.hashEmail(email);
    await this.clientFactory().$executeRaw`
      INSERT INTO registration_intents (email_hash, expires_at)
      VALUES (${emailHash}, now() + interval '7 days')
      ON CONFLICT (email_hash) DO UPDATE SET expires_at = GREATEST(registration_intents.expires_at, EXCLUDED.expires_at)
    `;
  }

  public async pruneExpired(): Promise<number> {
    return this.clientFactory().$executeRaw`
      DELETE FROM registration_intents WHERE expires_at <= now()
    `;
  }

  public async exists(id: string): Promise<boolean> {
    const rows = await this.clientFactory().$queryRaw<
      readonly { exists: boolean }[]
    >`
      SELECT EXISTS(SELECT 1 FROM user_profiles WHERE id = ${id}::uuid) AS exists
    `;
    return rows[0]?.exists === true;
  }

  private hashEmail(email: string): Buffer {
    const key = Buffer.from(this.keyFactory(), 'base64url');
    if (key.length < 32)
      throw new Error('Registration intent HMAC key is missing or too short.');
    return createHmac('sha256', key)
      .update(email.trim().toLowerCase(), 'utf8')
      .digest();
  }
}
