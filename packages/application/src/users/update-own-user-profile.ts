import type { Clock } from '../ports/clock.js';

export type UserProfile = Readonly<{
  id: string;
  displayName: string | null;
  locale: string;
  timeZone: string;
  presentationCurrency: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}>;

export type UpdateOwnUserProfileCommand = Readonly<{
  actorId: string;
  displayName: string | null;
  locale: string;
  timeZone: string;
  presentationCurrency: string;
}>;

export interface UserProfileRepository {
  findById(id: string): Promise<UserProfile | null>;
  upsert(profile: UserProfile): Promise<UserProfile>;
}

export class InvalidUserProfilePreferencesError extends Error {
  public constructor() {
    super('Invalid user profile preferences.');
    this.name = 'InvalidUserProfilePreferencesError';
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
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: command.timeZone });
    } catch {
      throw new InvalidUserProfilePreferencesError();
    }
    const instant = this.clock.now();
    return this.profiles.upsert({
      id: command.actorId,
      displayName: command.displayName,
      locale: command.locale,
      timeZone: command.timeZone,
      presentationCurrency: command.presentationCurrency,
      createdAt: instant,
      updatedAt: instant,
      version: 1,
    });
  }
}
