export class PasswordRejectedError extends Error {
  public constructor() {
    super('Password does not meet the configured provider policy.');
    this.name = 'PasswordRejectedError';
  }
}

export class PasswordCheckUnavailableError extends Error {
  public constructor() {
    super('Password safety check is unavailable.');
    this.name = 'PasswordCheckUnavailableError';
  }
}

export interface PasswordSafetyChecker {
  isCompromised(password: string): Promise<boolean>;
}
