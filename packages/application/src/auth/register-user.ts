export type RegisterUserCommand = Readonly<{
  displayName: string;
  email: string;
  password: string;
  confirmationRedirectUrl: string;
}>;

export interface IdentityRegistrationGateway {
  register(command: RegisterUserCommand): Promise<string | null>;
}

export interface PendingRegistrationProfileRepository {
  recordIntent(email: string): Promise<void>;
  createPending(id: string, displayName: string): Promise<void>;
}

export class RegisterUserUseCase {
  public constructor(
    private readonly identities: IdentityRegistrationGateway,
    private readonly profiles: PendingRegistrationProfileRepository,
  ) {}

  public async execute(command: RegisterUserCommand): Promise<void> {
    await this.profiles.recordIntent(command.email);
    const id = await this.identities.register(command);
    if (id !== null) await this.profiles.createPending(id, command.displayName);
  }
}
