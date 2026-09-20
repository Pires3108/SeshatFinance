export type RequestPasswordRecoveryCommand = Readonly<{
  email: string;
  redirectUrl: string;
}>;

export interface PasswordRecoveryGateway {
  request(command: RequestPasswordRecoveryCommand): Promise<void>;
}

export class RequestPasswordRecoveryUseCase {
  public constructor(private readonly recovery: PasswordRecoveryGateway) {}

  public async execute(command: RequestPasswordRecoveryCommand): Promise<void> {
    await this.recovery.request(command);
  }
}
