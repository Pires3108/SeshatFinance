import type { Clock } from '../ports/clock.js';

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

export type UpdateOwnUserProfileCommand = Readonly<{
  actorId: string;
  displayName: string | null;
  locale: string;
  timeZone: string;
  presentationCurrency: string;
  refundPresentation?: 'separate-income' | 'expense-offset';
}>;

export interface UserProfileRepository {
  findById(id: string): Promise<UserProfile | null>;
  upsert(profile: UserProfile): Promise<UserProfile>;
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
    const instant = this.clock.now();
    const existing = await this.profiles.findById(command.actorId);
    return this.profiles.upsert({
      id: command.actorId,
      displayName: command.displayName,
      locale: command.locale,
      timeZone: command.timeZone,
      presentationCurrency: command.presentationCurrency,
      refundPresentation:
        command.refundPresentation ??
        existing?.refundPresentation ??
        'separate-income',
      createdAt: instant,
      updatedAt: instant,
      version: 1,
    });
  }
}
