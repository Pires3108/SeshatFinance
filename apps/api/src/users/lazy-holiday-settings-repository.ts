import type {
  DeclaredHolidayRecord,
  HolidaySettings,
  HolidaySettingsRepository,
} from '@seshat/application';
import { PrismaHolidaySettingsRepository } from '@seshat/database';
import type { HolidayLocation } from '@seshat/domain';
import { Injectable } from '@nestjs/common';

import { LazyPrismaClient } from '../platform/lazy-prisma-client.js';

@Injectable()
export class LazyHolidaySettingsRepository implements HolidaySettingsRepository {
  private repository: PrismaHolidaySettingsRepository | undefined;

  public constructor(private readonly prisma: LazyPrismaClient) {}

  public findForOwner(ownerId: string): Promise<HolidaySettings> {
    return this.getRepository().findForOwner(ownerId);
  }

  public saveLocation(
    ownerId: string,
    location: HolidayLocation,
    updatedAt: Date,
  ): Promise<void> {
    return this.getRepository().saveLocation(ownerId, location, updatedAt);
  }

  public addDeclared(holiday: DeclaredHolidayRecord): Promise<void> {
    return this.getRepository().addDeclared(holiday);
  }

  public removeDeclared(id: string, ownerId: string): Promise<boolean> {
    return this.getRepository().removeDeclared(id, ownerId);
  }

  private getRepository(): PrismaHolidaySettingsRepository {
    this.repository ??= new PrismaHolidaySettingsRepository(this.prisma.get());
    return this.repository;
  }
}
