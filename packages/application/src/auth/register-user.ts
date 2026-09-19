export type RegisterUserCommand = Readonly<{
  displayName: string;
  email: string;
  password: string;
  confirmationRedirectUrl: string;
}>;

export interface IdentityRegistrationGateway {
  register(command: RegisterUserCommand): Promise<void>;
}

export class RegisterUserUseCase {
  public constructor(
    private readonly identities: IdentityRegistrationGateway,
  ) {}

  public async execute(command: RegisterUserCommand): Promise<void> {
    await this.identities.register(command);
  }
}
