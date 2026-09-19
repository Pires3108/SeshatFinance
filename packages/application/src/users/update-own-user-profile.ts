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
  upsert(profile: UserProfile): Promise<UserProfile>;
}

export class UpdateOwnUserProfileUseCase {
  public constructor(
    private readonly profiles: UserProfileRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(
    command: UpdateOwnUserProfileCommand,
  ): Promise<UserProfile> {
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
