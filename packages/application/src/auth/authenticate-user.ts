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

export interface LoginAttemptRepository {
  isLocked(email: string, now: Date): Promise<boolean>;
  recordFailure(email: string, now: Date): Promise<void>;
  clear(email: string): Promise<void>;
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
    if (await this.attempts.isLocked(email, this.clock.now())) {
      throw new Error('Authentication was not accepted.');
    }
    try {
      const session = await this.identities.authenticate({ ...command, email });
      await this.attempts.clear(email);
      return session;
    } catch {
      await this.attempts.recordFailure(email, this.clock.now());
      throw new Error('Authentication was not accepted.');
    }
  }
}
