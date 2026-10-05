import type {
  CompletePasswordRecoveryCommand,
  PasswordRecoveryCompletionGateway,
} from '@seshat/application';

export type SupabasePasswordRecoveryCompletionClient = Readonly<{
  auth: Readonly<{
    verifyOtp(
      input: Readonly<{ token_hash: string; type: 'recovery' }>,
    ): PromiseLike<
      Readonly<{ data: Readonly<{ session: unknown }>; error: unknown }>
    >;
    updateUser(
      input: Readonly<{ password: string }>,
    ): PromiseLike<Readonly<{ error: unknown }>>;
  }>;
}>;

export class SupabasePasswordRecoveryCompletionGateway implements PasswordRecoveryCompletionGateway {
  public constructor(
    private readonly clientFactory: () => SupabasePasswordRecoveryCompletionClient,
  ) {}

  public async complete(
    command: CompletePasswordRecoveryCommand,
  ): Promise<boolean> {
    const client = this.clientFactory();
    try {
      const verification = await client.auth.verifyOtp({
        token_hash: command.tokenHash,
        type: 'recovery',
      });
      if (verification.error !== null) {
        if (isInvalidRecoveryToken(verification.error)) return false;
        throw new Error('Recovery verification unavailable.');
      }
      if (verification.data.session === null) return false;
      const updated = await client.auth.updateUser({
        password: command.password,
      });
      if (updated.error !== null)
        throw new Error('Recovery update unavailable.');
      return true;
    } catch {
      throw new Error('Recovery provider unavailable.');
    }
  }
}

function isInvalidRecoveryToken(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'otp_expired'
  );
}
