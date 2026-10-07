import type {
  AuthenticatedActor,
  IdentityTokenVerifier,
} from '@seshat/application';
import { z } from 'zod';

const confirmedEmailSchema = z.email().max(320);

export type SupabaseUserVerificationClient = Readonly<{
  auth: Readonly<{
    getUser(accessToken: string): PromiseLike<
      Readonly<{
        data: Readonly<{
          user: Readonly<{
            id: string;
            email?: string | null;
            email_confirmed_at?: string | null;
          }> | null;
        }>;
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
    const confirmedEmail = normalizeConfirmedEmail(
      data.user.email,
      data.user.email_confirmed_at,
    );
    return confirmedEmail === undefined
      ? { id: data.user.id }
      : { id: data.user.id, confirmedEmail };
  }
}

function normalizeConfirmedEmail(
  email: string | null | undefined,
  confirmedAt: string | null | undefined,
): string | undefined {
  if (
    typeof email !== 'string' ||
    typeof confirmedAt !== 'string' ||
    !Number.isFinite(Date.parse(confirmedAt))
  ) {
    return undefined;
  }
  const normalized = email.trim().toLowerCase();
  return confirmedEmailSchema.safeParse(normalized).success
    ? normalized
    : undefined;
}
