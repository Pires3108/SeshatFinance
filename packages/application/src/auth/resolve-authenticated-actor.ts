export type AuthenticatedActor = Readonly<{
  id: string;
  /** Set only when the identity provider verified this email as confirmed. */
  confirmedEmail?: string;
}>;

export interface IdentityTokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedActor>;
}

export class ResolveAuthenticatedActorUseCase {
  public constructor(private readonly tokens: IdentityTokenVerifier) {}

  public execute(accessToken: string): Promise<AuthenticatedActor> {
    return this.tokens.verify(accessToken);
  }
}
