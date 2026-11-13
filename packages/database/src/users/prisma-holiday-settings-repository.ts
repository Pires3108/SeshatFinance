import type {
  DeclaredHolidayRecord,
  HolidaySettings,
  HolidaySettingsRepository,
} from '@seshat/application';
import type { HolidayLocation } from '@seshat/domain';

import type { PrismaClient } from '../generated/prisma/client.js';

const MAX_DECLARED_HOLIDAYS = 200;

export class PrismaHolidaySettingsRepository implements HolidaySettingsRepository {
  public constructor(private readonly client: PrismaClient) {}

  public async findForOwner(ownerId: string): Promise<HolidaySettings> {
    const [settings, declared] = await Promise.all([
      this.client.userHolidaySettings.findUnique({ where: { ownerId } }),
      this.client.userDeclaredHoliday.findMany({
        orderBy: [{ month: 'asc' }, { day: 'asc' }, { id: 'asc' }],
        take: MAX_DECLARED_HOLIDAYS,
        where: { ownerId },
      }),
    ]);
    return {
      declared: declared.map((row) => ({
        createdAt: row.createdAt,
        day: row.day,
        id: row.id,
        month: row.month,
        name: row.name,
        ownerId: row.ownerId,
        year: row.year,
      })),
      location: {
        municipalityCode: settings?.municipalityCode ?? null,
        stateCode: settings?.stateCode ?? null,
      },
    };
  }

  public async saveLocation(
    ownerId: string,
    location: HolidayLocation,
    updatedAt: Date,
  ): Promise<void> {
    await this.client.userHolidaySettings.upsert({
      create: { ownerId, ...location, updatedAt },
      update: { ...location, updatedAt },
      where: { ownerId },
    });
  }

  public async addDeclared(holiday: DeclaredHolidayRecord): Promise<void> {
    await this.client.userDeclaredHoliday.create({ data: { ...holiday } });
  }

  public async removeDeclared(id: string, ownerId: string): Promise<boolean> {
    const result = await this.client.userDeclaredHoliday.deleteMany({
      where: { id, ownerId },
    });
    return result.count === 1;
  }
}
