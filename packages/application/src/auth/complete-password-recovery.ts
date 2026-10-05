export type CompletePasswordRecoveryCommand = Readonly<{
  tokenHash: string;
  password: string;
}>;

export interface PasswordRecoveryCompletionGateway {
  complete(command: CompletePasswordRecoveryCommand): Promise<boolean>;
}

export class CompletePasswordRecoveryUseCase {
  public constructor(
    private readonly recovery: PasswordRecoveryCompletionGateway,
  ) {}

  public async execute(
    command: CompletePasswordRecoveryCommand,
  ): Promise<boolean> {
    return this.recovery.complete(command);
  }
}
