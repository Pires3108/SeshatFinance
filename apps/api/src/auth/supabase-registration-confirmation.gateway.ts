import {
  IdentityProviderUnavailableError,
  type ConfirmedRegistrationIdentity,
  type RegistrationConfirmationGateway,
} from '@seshat/application';
import { z } from 'zod';

export type SupabaseRegistrationConfirmationClient = Readonly<{
  auth: Readonly<{
    verifyOtp(
      input: Readonly<{ token_hash: string; type: 'email' }>,
    ): PromiseLike<
      Readonly<{ data: Readonly<{ user: unknown }>; error: unknown }>
    >;
  }>;
}>;

const confirmedUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  email_confirmed_at: z.iso.datetime({ offset: true }),
  user_metadata: z.object({ display_name: z.unknown().optional() }).optional(),
});

export class SupabaseRegistrationConfirmationGateway implements RegistrationConfirmationGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseRegistrationConfirmationClient,
  ) {}

  public async confirm(
    tokenHash: string,
  ): Promise<ConfirmedRegistrationIdentity | null> {
    try {
      const { data, error } = await this.clientFactory().auth.verifyOtp({
        token_hash: tokenHash,
        type: 'email',
      });
      if (error !== null) {
        if (
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'otp_expired' || error.code === 'invalid_otp')
        )
          return null;
        throw new IdentityProviderUnavailableError();
      }
      const identity = confirmedUserSchema.safeParse(data.user);
      if (!identity.success) return null;
      const displayName = identity.data.user_metadata?.display_name;
      return {
        id: identity.data.id,
        email: identity.data.email,
        displayName:
          typeof displayName === 'string' &&
          displayName.trim().length <= 120 &&
          displayName.trim().length > 0
            ? displayName.trim()
            : null,
      };
    } catch {
      throw new IdentityProviderUnavailableError();
    }
  }
}
