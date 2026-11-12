import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import { isIanaTimeZone } from './iana-time-zone.js';

export type UserProfile = Readonly<{
  id: string;
  displayName: string | null;
  locale: string;
  timeZone: string;
  presentationCurrency: string;
  refundPresentation: 'separate-income' | 'expense-offset';
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export const timeZoneChangeScopes = [
  'reinterpret_existing',
  'new_items_only',
] as const;
export type TimeZoneChangeScope = (typeof timeZoneChangeScopes)[number];

export type UserTimeZoneChange = Readonly<{
  id: string;
  ownerId: string;
  previousTimeZone: string;
  newTimeZone: string;
  scope: TimeZoneChangeScope;
  changedAt: Date;
}>;

export type UpdateOwnUserProfileCommand = Readonly<{
  actorId: string;
  displayName: string | null;
  locale: string;
  timeZone: string;
  presentationCurrency: string;
  timeZoneChangeScope?: TimeZoneChangeScope;
  refundPresentation?: 'separate-income' | 'expense-offset';
}>;

export interface UserProfileRepository {
  findById(id: string): Promise<UserProfile | null>;
  /** Creates the profile, or updates preferences other than the time zone. */
  upsert(profile: UserProfile): Promise<UserProfile>;
  /**
   * Atomically applies a time zone change and appends its audit record.
   * Returns null when the profile no longer matches expectedVersion.
   */
  changeTimeZone(
    profile: UserProfile,
    expectedVersion: number,
    change: UserTimeZoneChange,
  ): Promise<UserProfile | null>;
}

export class InvalidUserProfilePreferencesError extends Error {
  public constructor() {
    super('Invalid user profile preferences.');
    this.name = 'InvalidUserProfilePreferencesError';
  }
}

export class TimeZoneChangeScopeRequiredError extends Error {
  public constructor() {
    super('A time zone change requires an explicit scope.');
    this.name = 'TimeZoneChangeScopeRequiredError';
  }
}

export class UserProfileVersionConflictError extends Error {
  public constructor() {
    super('User profile was modified concurrently.');
    this.name = 'UserProfileVersionConflictError';
  }
}

export class GetOwnUserProfileUseCase {
  public constructor(private readonly profiles: UserProfileRepository) {}

  public execute(actorId: string): Promise<UserProfile | null> {
    return this.profiles.findById(actorId);
  }
}

export class UpdateOwnUserProfileUseCase {
  public constructor(
    private readonly profiles: UserProfileRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(
    command: UpdateOwnUserProfileCommand,
  ): Promise<UserProfile> {
    if (command.locale !== 'pt-BR') {
      throw new InvalidUserProfilePreferencesError();
    }
    if (command.presentationCurrency !== 'BRL') {
      throw new InvalidUserProfilePreferencesError();
    }
    if (!isIanaTimeZone(command.timeZone)) {
      throw new InvalidUserProfilePreferencesError();
    }
    const current = await this.profiles.findById(command.actorId);
    const instant = this.clock.now();
    const profile: UserProfile = {
      id: command.actorId,
      displayName: command.displayName,
      locale: command.locale,
      timeZone: command.timeZone,
      presentationCurrency: command.presentationCurrency,
      refundPresentation:
        command.refundPresentation ??
        current?.refundPresentation ??
        'separate-income',
      createdAt: current?.createdAt ?? instant,
      updatedAt: instant,
      version: current?.version ?? 1,
    };
    if (current === null || current.timeZone === command.timeZone) {
      return this.profiles.upsert(profile);
    }
    if (command.timeZoneChangeScope === undefined) {
      throw new TimeZoneChangeScopeRequiredError();
    }
    const changed = await this.profiles.changeTimeZone(
      profile,
      current.version,
      {
        id: this.identifiers.generate(),
        ownerId: command.actorId,
        previousTimeZone: current.timeZone,
        newTimeZone: command.timeZone,
        scope: command.timeZoneChangeScope,
        changedAt: instant,
      },
    );
    if (changed === null) throw new UserProfileVersionConflictError();
    return changed;
  }
}
