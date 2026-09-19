import type {
  IdentityRegistrationGateway,
  RegisterUserCommand,
} from '@seshat/application';

export type SupabaseRegistrationClient = Readonly<{
  auth: Readonly<{
    signUp(
      credentials: Readonly<{
        email: string;
        password: string;
        options: Readonly<{
          data: Readonly<{ display_name: string }>;
          emailRedirectTo: string;
        }>;
      }>,
    ): PromiseLike<Readonly<{ error: unknown }>>;
  }>;
}>;

export class IdentityRegistrationError extends Error {
  public constructor() {
    super('Identity registration was not accepted.');
    this.name = 'IdentityRegistrationError';
  }
}

export class SupabaseIdentityRegistrationGateway implements IdentityRegistrationGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseRegistrationClient,
  ) {}

  public async register(command: RegisterUserCommand): Promise<void> {
    const { error } = await this.clientFactory().auth.signUp({
      email: command.email,
      password: command.password,
      options: {
        data: { display_name: command.displayName },
        emailRedirectTo: command.confirmationRedirectUrl,
      },
    });

    if (error) {
      throw new IdentityRegistrationError();
    }
  }
}
