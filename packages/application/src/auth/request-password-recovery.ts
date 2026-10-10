export type RequestPasswordRecoveryCommand = Readonly<{
  email: string;
  redirectUrl: string;
}>;

export interface PasswordRecoveryGateway {
  request(command: RequestPasswordRecoveryCommand): Promise<void>;
}

export interface RecoveryRequestAttemptRepository {
  allowAndRecord(email: string, now: Date): Promise<boolean>;
}

export class RequestPasswordRecoveryUseCase {
  public constructor(
    private readonly recovery: PasswordRecoveryGateway,
    private readonly attempts: RecoveryRequestAttemptRepository,
    private readonly clock: Readonly<{ now(): Date }>,
  ) {}

  public async execute(command: RequestPasswordRecoveryCommand): Promise<void> {
    const email = command.email.trim().toLowerCase();
    if (!(await this.attempts.allowAndRecord(email, this.clock.now()))) return;
    await this.recovery.request({ ...command, email });
  }
}
