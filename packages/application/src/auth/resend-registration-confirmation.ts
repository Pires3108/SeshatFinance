export type ResendRegistrationConfirmationCommand = Readonly<{
  email: string;
  confirmationRedirectUrl: string;
}>;

export interface RegistrationConfirmationResendGateway {
  resend(command: ResendRegistrationConfirmationCommand): Promise<void>;
}

export class ResendRegistrationConfirmationUseCase {
  public constructor(
    private readonly gateway: RegistrationConfirmationResendGateway,
  ) {}

  public execute(
    command: ResendRegistrationConfirmationCommand,
  ): Promise<void> {
    return this.gateway.resend(command);
  }
}
