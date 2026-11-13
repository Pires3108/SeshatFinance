import {
  assertHolidayLocation,
  brazilHolidayPredicate,
  CivilDate,
  type HolidayLocation,
  type HolidayPredicate,
} from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export type DeclaredHolidayRecord = Readonly<{
  id: string;
  ownerId: string;
  name: string;
  month: number;
  day: number;
  /** null repeats every year. */
  year: number | null;
  createdAt: Date;
}>;

export type HolidaySettings = Readonly<{
  location: HolidayLocation;
  declared: readonly DeclaredHolidayRecord[];
}>;

export interface HolidaySettingsRepository {
  findForOwner(ownerId: string): Promise<HolidaySettings>;
  saveLocation(
    ownerId: string,
    location: HolidayLocation,
    updatedAt: Date,
  ): Promise<void>;
  addDeclared(holiday: DeclaredHolidayRecord): Promise<void>;
  /** Returns false when the holiday does not exist for the owner. */
  removeDeclared(id: string, ownerId: string): Promise<boolean>;
}

export class InvalidDeclaredHolidayError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidDeclaredHolidayError';
  }
}

const UNCONFIGURED: HolidayLocation = {
  municipalityCode: null,
  stateCode: null,
};

export const EMPTY_HOLIDAY_SETTINGS: HolidaySettings = {
  declared: [],
  location: UNCONFIGURED,
};

/** Holiday predicate for the holder's configured location. */
export async function resolveHolidayPredicate(
  settings: HolidaySettingsRepository,
  ownerId: string,
): Promise<HolidayPredicate> {
  const current = await settings.findForOwner(ownerId);
  return brazilHolidayPredicate(current.location, current.declared);
}

export class GetHolidaySettingsUseCase {
  public constructor(private readonly settings: HolidaySettingsRepository) {}

  public execute(actorId: string): Promise<HolidaySettings> {
    return this.settings.findForOwner(actorId);
  }
}

export class UpdateHolidayLocationUseCase {
  public constructor(
    private readonly settings: HolidaySettingsRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(
    command: Readonly<{ actorId: string } & HolidayLocation>,
  ): Promise<HolidaySettings> {
    const location: HolidayLocation = {
      municipalityCode: command.municipalityCode,
      stateCode: command.stateCode,
    };
    assertHolidayLocation(location);
    await this.settings.saveLocation(
      command.actorId,
      location,
      this.clock.now(),
    );
    return this.settings.findForOwner(command.actorId);
  }
}

export type DeclareHolidayCommand = Readonly<{
  actorId: string;
  name: string;
  month: number;
  day: number;
  year: number | null;
}>;

export class DeclareHolidayUseCase {
  public constructor(
    private readonly settings: HolidaySettingsRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: DeclareHolidayCommand,
  ): Promise<DeclaredHolidayRecord> {
    const name = command.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new InvalidDeclaredHolidayError(
        'Holiday name must have 1 to 120 characters.',
      );
    }
    try {
      // Feb 29 is valid for recurring holidays; it applies in leap years.
      CivilDate.of(command.year ?? 2000, command.month, command.day);
    } catch {
      throw new InvalidDeclaredHolidayError('Holiday date is invalid.');
    }
    const holiday: DeclaredHolidayRecord = {
      createdAt: this.clock.now(),
      day: command.day,
      id: this.identifiers.generate(),
      month: command.month,
      name,
      ownerId: command.actorId,
      year: command.year,
    };
    await this.settings.addDeclared(holiday);
    return holiday;
  }
}

export class RemoveDeclaredHolidayUseCase {
  public constructor(private readonly settings: HolidaySettingsRepository) {}

  public execute(id: string, actorId: string): Promise<boolean> {
    return this.settings.removeDeclared(id, actorId);
  }
}
