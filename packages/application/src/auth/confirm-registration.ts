import type { Clock } from '../ports/clock.js';

export class IdentityProviderUnavailableError extends Error {
  public constructor() {
    super('Identity provider unavailable.');
    this.name = 'IdentityProviderUnavailableError';
  }
}

export type ConfirmedRegistrationIdentity = Readonly<{
  id: string;
  email: string;
  displayName: string | null;
}>;

export interface RegistrationConfirmationGateway {
  confirm(tokenHash: string): Promise<ConfirmedRegistrationIdentity | null>;
}

export interface ConfirmedIdentityProfileRepository {
  ready(): Promise<void>;
  ensure(
    identity: ConfirmedRegistrationIdentity,
    confirmedAt: Date,
  ): Promise<void>;
}

export class ConfirmRegistrationUseCase {
  public constructor(
    private readonly identities: RegistrationConfirmationGateway,
    private readonly profiles: ConfirmedIdentityProfileRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(tokenHash: string): Promise<boolean> {
    await this.profiles.ready();
    const identity = await this.identities.confirm(tokenHash);
    if (identity === null) return false;
    await this.profiles.ensure(identity, this.clock.now());
    return true;
  }
}
