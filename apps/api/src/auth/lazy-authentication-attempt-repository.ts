import type {
  AuthenticationAttempt,
  AuthenticationAttemptRepository,
  AuthenticationAttemptResult,
} from '@seshat/application';
import { PrismaAuthenticationAttemptRepository } from '@seshat/database';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyAuthenticationAttemptRepository implements AuthenticationAttemptRepository {
  public constructor(private readonly prisma: LazyPrismaClient) {}

  public execute(
    normalizedEmail: string,
    now: Date,
    authenticate: () => Promise<AuthenticationAttempt>,
  ): Promise<AuthenticationAttemptResult> {
    return new PrismaAuthenticationAttemptRepository(
      this.prisma.get(),
      process.env.AUTH_RATE_LIMIT_HMAC_KEY ?? '',
    ).execute(normalizedEmail, now, authenticate);
  }
}
