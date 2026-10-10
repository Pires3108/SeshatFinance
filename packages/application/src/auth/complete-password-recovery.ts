import type { OpaqueSessionService } from './opaque-session.js';

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
  ): Promise<void>;
}

export class CompletePasswordRecoveryUseCase {
  public constructor(
    private readonly recovery: PasswordRecoveryCompletionGateway,
    private readonly sessions: OpaqueSessionService,
  ) {}

  public execute(tokenHash: string, password: string): Promise<void> {
    return this.recovery.complete(tokenHash, password, (userId) =>
      this.sessions.revokeAllForUser(userId),
    );
  }
}
