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

export class AuthenticateUserUseCase {
  public constructor(
    private readonly identities: IdentityAuthenticationGateway,
    private readonly attempts: LoginAttemptRepository,
    private readonly clock: Readonly<{ now(): Date }>,
  ) {}

  public async execute(
    command: AuthenticateUserCommand,
  ): Promise<IdentitySession> {
    const email = command.email.trim().toLowerCase();
    const session = await this.attempts.runExclusive(email, async (state) => {
      if (await state.isLocked(this.clock.now())) return null;
      try {
        const authenticated = await this.identities.authenticate({
          ...command,
          email,
        });
        await state.clear();
        return authenticated;
      } catch {
        await state.recordFailure(this.clock.now());
        return null;
      }
    });
    if (session === null) throw new Error('Authentication was not accepted.');
    return session;
  }
}
