export type AuthenticateUserCommand = Readonly<{
  email: string;
  password: string;
}>;

export type IdentitySession = Readonly<{
  userId: string;
}>;

export interface IdentityAuthenticationGateway {
  authenticate(command: AuthenticateUserCommand): Promise<IdentitySession>;
}

export interface LoginAttemptState {
  isLocked(now: Date): Promise<boolean>;
  recordFailure(now: Date): Promise<void>;
  clear(): Promise<void>;
}

export interface LoginAttemptRepository {
  runExclusive<T>(
    email: string,
    action: (state: LoginAttemptState) => Promise<T>,
  ): Promise<T>;
}

export class AuthenticationRejectedError extends Error {
  public constructor() {
    super('Authentication was not accepted.');
    this.name = 'AuthenticationRejectedError';
  }
}

export class AuthenticateUserUseCase {
  public constructor(
    private readonly identities: IdentityAuthenticationGateway,
    private readonly attempts: LoginAttemptRepository,
    private readonly clock: Readonly<{ now(): Date }>,
  ) {}

  public async execute(
    command: AuthenticateUserCommand,
  ): Promise<IdentitySession> {
    return this.executeWith(command, (identity) => Promise.resolve(identity));
  }

  public async executeWith<T>(
    command: AuthenticateUserCommand,
    onAuthenticated: (identity: IdentitySession) => Promise<T>,
  ): Promise<T> {
    const email = command.email.trim().toLowerCase();
    const session = await this.attempts.runExclusive(email, async (state) => {
      if (await state.isLocked(this.clock.now())) return null;
      let authenticated: IdentitySession;
      try {
        authenticated = await this.identities.authenticate({
          ...command,
          email,
        });
      } catch {
        await state.recordFailure(this.clock.now());
        return null;
      }
      await state.clear();
      return { value: await onAuthenticated(authenticated) };
    });
    if (session === null) throw new AuthenticationRejectedError();
    return session.value;
  }
}
