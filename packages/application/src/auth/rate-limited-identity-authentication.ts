import type { Clock } from '../ports/clock.js';

import {
  type AuthenticateUserCommand,
  type IdentityAuthenticationGateway,
  type IdentitySession,
} from './authenticate-user.js';

export type AuthenticationAttempt =
  | Readonly<{ kind: 'accepted'; session: IdentitySession }>
  | Readonly<{ kind: 'rejected' }>
  | Readonly<{ kind: 'unavailable' }>;

export type AuthenticationAttemptResult =
  AuthenticationAttempt | Readonly<{ kind: 'blocked' }>;

export interface AuthenticationAttemptRepository {
  execute(
    normalizedEmail: string,
    now: Date,
    authenticate: () => Promise<AuthenticationAttempt>,
  ): Promise<AuthenticationAttemptResult>;
}

export class InvalidIdentityCredentialsError extends Error {
  public constructor() {
    super('Identity authentication was not accepted.');
    this.name = 'InvalidIdentityCredentialsError';
  }
}

export class IdentityProviderUnavailableError extends Error {
  public constructor() {
    super('Identity provider is unavailable.');
    this.name = 'IdentityProviderUnavailableError';
  }
}

export class RateLimitedIdentityAuthenticationGateway implements IdentityAuthenticationGateway {
  public constructor(
    private readonly identities: IdentityAuthenticationGateway,
    private readonly attempts: AuthenticationAttemptRepository,
    private readonly clock: Clock,
  ) {}

  public async authenticate(
    command: AuthenticateUserCommand,
  ): Promise<IdentitySession> {
    const result = await this.attempts.execute(
      command.email.trim().toLowerCase(),
      this.clock.now(),
      async (): Promise<AuthenticationAttempt> => {
        try {
          return {
            kind: 'accepted',
            session: await this.identities.authenticate(command),
          };
        } catch (error) {
          return error instanceof InvalidIdentityCredentialsError
            ? { kind: 'rejected' }
            : { kind: 'unavailable' };
        }
      },
    );

    if (result.kind === 'accepted') return result.session;
    if (result.kind === 'unavailable')
      throw new IdentityProviderUnavailableError();
    throw new InvalidIdentityCredentialsError();
  }
}
