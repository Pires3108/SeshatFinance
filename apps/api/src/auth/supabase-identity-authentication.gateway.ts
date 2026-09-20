import type {
  AuthenticateUserCommand,
  IdentityAuthenticationGateway,
  IdentitySession,
} from '@seshat/application';

export type SupabaseAuthenticationClient = Readonly<{
  auth: Readonly<{
    signInWithPassword(credentials: AuthenticateUserCommand): PromiseLike<
      Readonly<{
        data: Readonly<{
          session: Readonly<{
            access_token: string;
            expires_at?: number;
            refresh_token: string;
            user: Readonly<{ id: string }>;
          }> | null;
        }>;
        error: unknown;
      }>
    >;
  }>;
}>;

export class IdentityAuthenticationError extends Error {
  public constructor() {
    super('Identity authentication was not accepted.');
    this.name = 'IdentityAuthenticationError';
  }
}

export class SupabaseIdentityAuthenticationGateway implements IdentityAuthenticationGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseAuthenticationClient,
  ) {}

  public async authenticate(
    command: AuthenticateUserCommand,
  ): Promise<IdentitySession> {
    const { data, error } =
      await this.clientFactory().auth.signInWithPassword(command);
    if (error || data.session?.expires_at === undefined) {
      throw new IdentityAuthenticationError();
    }

    return {
      accessToken: data.session.access_token,
      expiresAt: new Date(data.session.expires_at * 1000),
      refreshToken: data.session.refresh_token,
      userId: data.session.user.id,
    };
  }
}
