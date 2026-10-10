import type {
  OpaqueSession,
  OpaqueSessionRepository,
} from '@seshat/application';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaOpaqueSessionRepository implements OpaqueSessionRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async create(session: OpaqueSession): Promise<void> {
    await this.client.userSession.create({ data: session });
  }

  public async findByTokenHash(
    tokenHash: string,
  ): Promise<OpaqueSession | null> {
    return this.client.userSession.findUnique({ where: { tokenHash } });
  }

  public async touchIfActive(id: string, seenAt: Date): Promise<boolean> {
    const result = await this.client.userSession.updateMany({
      where: {
        id,
        revokedAt: null,
        createdAt: { gt: new Date(seenAt.getTime() - 12 * 60 * 60_000) },
        lastSeenAt: { gt: new Date(seenAt.getTime() - 30 * 60_000) },
      },
      data: { lastSeenAt: seenAt },
    });
    return result.count === 1;
  }

  public async revoke(id: string, revokedAt: Date): Promise<void> {
    await this.client.userSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
    });
  }

  public async revokeOthers(
    userId: string,
    exceptId: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.client.userSession.updateMany({
      where: { userId, id: { not: exceptId }, revokedAt: null },
      data: { revokedAt },
    });
  }

  public async revokeAll(userId: string, revokedAt: Date): Promise<void> {
    await this.client.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }
}
