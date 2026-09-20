import type {
  PasswordRecoveryGateway,
  RequestPasswordRecoveryCommand,
} from '@seshat/application';

export type SupabasePasswordRecoveryClient = Readonly<{
  auth: Readonly<{
    resetPasswordForEmail(
      email: string,
      options: Readonly<{ redirectTo: string }>,
    ): PromiseLike<Readonly<{ error: unknown }>>;
  }>;
}>;

export class SupabasePasswordRecoveryGateway implements PasswordRecoveryGateway {
  public constructor(
    private readonly clientFactory: () => SupabasePasswordRecoveryClient,
  ) {}

  public async request(command: RequestPasswordRecoveryCommand): Promise<void> {
    await this.clientFactory().auth.resetPasswordForEmail(command.email, {
      redirectTo: command.redirectUrl,
    });
  }
}
