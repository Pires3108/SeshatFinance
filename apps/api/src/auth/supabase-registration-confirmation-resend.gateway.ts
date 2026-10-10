import type {
  RegistrationConfirmationResendGateway,
  ResendRegistrationConfirmationCommand,
} from '@seshat/application';
import { IdentityProviderUnavailableError } from '@seshat/application';

export type SupabaseConfirmationResendClient = Readonly<{
  auth: Readonly<{
    resend(
      input: Readonly<{
        type: 'signup';
        email: string;
        options: Readonly<{ emailRedirectTo: string }>;
      }>,
    ): PromiseLike<Readonly<{ error: unknown }>>;
  }>;
}>;

export class SupabaseRegistrationConfirmationResendGateway implements RegistrationConfirmationResendGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseConfirmationResendClient,
  ) {}

  public async resend(
    command: ResendRegistrationConfirmationCommand,
  ): Promise<void> {
    try {
      const { error } = await this.clientFactory().auth.resend({
        type: 'signup',
        email: command.email,
        options: { emailRedirectTo: command.confirmationRedirectUrl },
      });
      if (error !== null && !isNonEnumeratingRejection(error))
        throw new IdentityProviderUnavailableError();
    } catch {
      throw new IdentityProviderUnavailableError();
    }
  }
}

function isNonEnumeratingRejection(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'user_not_found' ||
      error.code === 'email_not_confirmed' ||
      error.code === 'otp_expired')
  );
}
