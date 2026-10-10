import type { OpaqueSessionService } from './opaque-session.js';
import type { LoginAttemptRepository } from './authenticate-user.js';
import {
  PasswordRejectedError,
  type PasswordSafetyChecker,
} from './password-rejected.js';

export class InvalidRecoveryTokenError extends Error {
  public constructor() {
    super('Recovery token is invalid or expired.');
    this.name = 'InvalidRecoveryTokenError';
  }
}

export interface PasswordRecoveryCompletionGateway {
  complete(
    tokenHash: string,
    password: string,
    revokeSessions: (userId: string) => Promise<void>,
    runExclusive: (email: string, action: () => Promise<void>) => Promise<void>,
  ): Promise<void>;
}

export class CompletePasswordRecoveryUseCase {
  public constructor(
    private readonly recovery: PasswordRecoveryCompletionGateway,
    private readonly sessions: OpaqueSessionService,
    private readonly attempts: LoginAttemptRepository,
    private readonly passwords: PasswordSafetyChecker,
  ) {}

  public execute(tokenHash: string, password: string): Promise<void> {
    return this.executeReady(tokenHash, password);
  }

  private async executeReady(
    tokenHash: string,
    password: string,
  ): Promise<void> {
    await this.sessions.ready();
    if (await this.passwords.isCompromised(password))
      throw new PasswordRejectedError();
    await this.recovery.complete(
      tokenHash,
      password,
      (userId) => this.sessions.revokeAllForUser(userId),
      (email, action) =>
        this.attempts.runExclusive(email.trim().toLowerCase(), () => action()),
    );
  }
}
