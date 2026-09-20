import type {
  AuthenticatedActor,
  IdentityTokenVerifier,
} from '@seshat/application';

export type SupabaseUserVerificationClient = Readonly<{
  auth: Readonly<{
    getUser(accessToken: string): PromiseLike<
      Readonly<{
        data: Readonly<{ user: Readonly<{ id: string }> | null }>;
        error: unknown;
      }>
    >;
  }>;
}>;

export class InvalidIdentityTokenError extends Error {
  public constructor() {
    super('Identity token is invalid.');
    this.name = 'InvalidIdentityTokenError';
  }
}

export class SupabaseIdentityTokenVerifier implements IdentityTokenVerifier {
  public constructor(
    private readonly clientFactory: () => SupabaseUserVerificationClient,
  ) {}

  public async verify(accessToken: string): Promise<AuthenticatedActor> {
    const { data, error } =
      await this.clientFactory().auth.getUser(accessToken);
    if (error || data.user === null) {
      throw new InvalidIdentityTokenError();
    }
    return { id: data.user.id };
  }
}
