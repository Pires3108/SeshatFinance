import type {
  AuthenticatedActor,
  ConfirmedRegistrationIdentity,
  IdentityTokenVerifier,
} from '@seshat/application';
import { z } from 'zod';

const confirmedUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  email_confirmed_at: z.iso.datetime({ offset: true }),
});

export type SupabaseUserVerificationClient = Readonly<{
  auth: Readonly<{
    getUser(accessToken: string): PromiseLike<
      Readonly<{
        data: Readonly<{ user: unknown }>;
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
    private readonly profiles: Readonly<{
      ensure(
        identity: ConfirmedRegistrationIdentity,
        confirmedAt: Date,
      ): Promise<void>;
      exists(id: string): Promise<boolean>;
    }>,
    private readonly clock: Readonly<{ now(): Date }>,
  ) {}

  public async verify(accessToken: string): Promise<AuthenticatedActor> {
    const { data, error } =
      await this.clientFactory().auth.getUser(accessToken);
    const parsed = confirmedUserSchema.safeParse(data.user);
    if (error || !parsed.success) {
      throw new InvalidIdentityTokenError();
    }
    const user = parsed.data;
    try {
      await this.profiles.ensure(
        { id: user.id, email: user.email, displayName: null },
        this.clock.now(),
      );
      if (!(await this.profiles.exists(user.id)))
        throw new InvalidIdentityTokenError();
    } catch {
      throw new InvalidIdentityTokenError();
    }
    return { id: user.id };
  }
}
