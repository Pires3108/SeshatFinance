import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaRecoveryRequestAttemptRepository } from '@seshat/database';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';
import { AuthConfiguration } from './auth-configuration.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class RecoveryRequestAttemptPruner
  implements OnModuleInit, OnModuleDestroy
{
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    private readonly prisma: LazyPrismaClient,
    private readonly configuration: AuthConfiguration,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(
      () => {
        void this.prune();
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
    void this.prune();
  }

  public onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  private async prune(): Promise<void> {
    try {
      await new PrismaRecoveryRequestAttemptRepository(
        () => this.prisma.get(),
        () => this.configuration.readIntentHmacKey(),
      ).pruneOlderThan(new Date(Date.now() - RETENTION_MS));
    } catch {
      // Database readiness is checked on requests; retry on the next interval.
    }
  }
}
