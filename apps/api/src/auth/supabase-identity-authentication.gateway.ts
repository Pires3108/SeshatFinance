import type {
  AuthenticateUserCommand,
  IdentityAuthenticationGateway,
  IdentitySession,
} from '@seshat/application';
import {
  IdentityProviderUnavailableError,
  InvalidIdentityCredentialsError,
} from '@seshat/application';

export type SupabaseAuthenticationClient = Readonly<{
  auth: Readonly<{
    signInWithPassword(credentials: AuthenticateUserCommand): PromiseLike<
      Readonly<{
        data: Readonly<{
          session: Readonly<{
            user: Readonly<{ id: string }>;
          }> | null;
        }>;
        error: unknown;
      }>
    >;
  }>;
}>;

export class SupabaseIdentityAuthenticationGateway implements IdentityAuthenticationGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseAuthenticationClient,
  ) {}

  public async authenticate(
    command: AuthenticateUserCommand,
  ): Promise<IdentitySession> {
    const { data, error } =
      await this.clientFactory().auth.signInWithPassword(command);
    if (isCredentialRejection(error))
      throw new InvalidIdentityCredentialsError();
    if (error || data.session === null)
      throw new IdentityProviderUnavailableError();

    return {
      userId: data.session.user.id,
    };
  }
}

function isCredentialRejection(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error))
    return false;
  return (
    error.code === 'invalid_credentials' || error.code === 'email_not_confirmed'
  );
}
