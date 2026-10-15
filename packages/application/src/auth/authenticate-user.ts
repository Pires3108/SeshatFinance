export type AuthenticateUserCommand = Readonly<{
  email: string;
  password: string;
  origin?: string;
}>;

export interface LoginOriginAttemptRepository {
  reserve(origin: string, now: Date): Promise<string | null>;
  finish(
    origin: string,
    reservation: string,
    failed: boolean,
    now: Date,
  ): Promise<void>;
}

export type IdentitySession = Readonly<{
  userId: string;
}>;

export interface IdentityAuthenticationGateway {
  authenticate(command: AuthenticateUserCommand): Promise<IdentitySession>;
}

export class IdentityCredentialsRejectedError extends Error {
  public constructor() {
    super('Identity credentials were not accepted.');
    this.name = 'IdentityCredentialsRejectedError';
  }
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
    private readonly origins?: LoginOriginAttemptRepository,
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
    if (this.origins && !command.origin)
      throw new AuthenticationRejectedError();
    const reservation =
      this.origins && command.origin
        ? await this.origins.reserve(command.origin, this.clock.now())
        : undefined;
    if (reservation === null) throw new AuthenticationRejectedError();
    let failed = false;
    try {
      const session = await this.attempts.runExclusive(email, async (state) => {
        if (await state.isLocked(this.clock.now())) return null;
        let authenticated: IdentitySession;
        try {
          authenticated = await this.identities.authenticate({
            email,
            password: command.password,
          });
        } catch (error) {
          if (!(error instanceof IdentityCredentialsRejectedError)) throw error;
          failed = true;
          await state.recordFailure(this.clock.now());
          return null;
        }
        await state.clear();
        return { value: await onAuthenticated(authenticated) };
      });
      if (session === null) throw new AuthenticationRejectedError();
      return session.value;
    } finally {
      if (this.origins && command.origin && reservation)
        await this.origins.finish(
          command.origin,
          reservation,
          failed,
          this.clock.now(),
        );
    }
  }
}
