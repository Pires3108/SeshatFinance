import { IdentityCredentialsRejectedError } from '@seshat/application';
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
          }> | null;
        }>;
        error: unknown;
      }>
    >;
  }>;
}>;

export class IdentityAuthenticationError extends IdentityCredentialsRejectedError {
  public constructor() {
    super();
    this.name = 'IdentityAuthenticationError';
  }
}

export class SupabaseIdentityAuthenticationGateway implements IdentityAuthenticationGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseAuthenticationClient,
    private readonly verifyIdentity: (
      accessToken: string,
    ) => Promise<Readonly<{ id: string }>>,
  ) {}

  public async authenticate(
    command: AuthenticateUserCommand,
  ): Promise<IdentitySession> {
    const { data, error } = await withTimeout(
      this.clientFactory().auth.signInWithPassword(command),
    );
    if (error && !isCredentialRejection(error))
      throw new Error('Identity provider is unavailable.');
    if (error || data.session === null) {
      throw new IdentityAuthenticationError();
    }

    const actor = await withTimeout(
      this.verifyIdentity(data.session.access_token),
    );
    return { userId: actor.id };
  }
}

function isCredentialRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false;
  return (
    error.code === 'invalid_credentials' || error.code === 'email_not_confirmed'
  );
}

async function withTimeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new IdentityProviderTimeoutError());
        }, 30_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class IdentityProviderTimeoutError extends Error {
  public constructor() {
    super('Identity provider timed out.');
  }
}
