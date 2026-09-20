export type AuthenticateUserCommand = Readonly<{
  email: string;
  password: string;
}>;

export type IdentitySession = Readonly<{
  accessToken: string;
  expiresAt: Date;
  refreshToken: string;
  userId: string;
}>;

export interface IdentityAuthenticationGateway {
  authenticate(command: AuthenticateUserCommand): Promise<IdentitySession>;
}

export class AuthenticateUserUseCase {
  public constructor(
    private readonly identities: IdentityAuthenticationGateway,
  ) {}

  public execute(command: AuthenticateUserCommand): Promise<IdentitySession> {
    return this.identities.authenticate(command);
  }
}
