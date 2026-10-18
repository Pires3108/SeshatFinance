import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaConfirmedIdentityProfileRepository } from '@seshat/database';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';
import { AuthConfiguration } from './auth-configuration.js';

@Injectable()
export class RegistrationIntentPruner implements OnModuleInit, OnModuleDestroy {
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
      await new PrismaConfirmedIdentityProfileRepository(
        () => this.prisma.get(),
        () => this.configuration.readIntentHmacKey(),
      ).pruneExpired();
    } catch {
      // Database readiness is checked on requests; retry on the next interval.
    }
  }
}
