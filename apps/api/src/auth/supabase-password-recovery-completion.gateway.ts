import {
  IdentityProviderUnavailableError,
  InvalidRecoveryTokenError,
  type PasswordRecoveryCompletionGateway,
} from '@seshat/application';
import { z } from 'zod';

export type SupabaseRecoveryCompletionClient = Readonly<{
  auth: Readonly<{
    verifyOtp(
      input: Readonly<{ token_hash: string; type: 'recovery' }>,
    ): PromiseLike<
      Readonly<{
        data: Readonly<{ user: unknown }>;
        error: unknown;
      }>
    >;
    updateUser(
      input: Readonly<{ password: string }>,
    ): PromiseLike<Readonly<{ error: unknown }>>;
  }>;
}>;

const recoveryUserSchema = z.object({ id: z.uuid(), email: z.email() });

function isInvalidProof(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'otp_expired' || error.code === 'invalid_otp')
  );
}

export class SupabasePasswordRecoveryCompletionGateway implements PasswordRecoveryCompletionGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseRecoveryCompletionClient,
  ) {}

  public async complete(
    tokenHash: string,
    password: string,
    revokeSessions: (userId: string) => Promise<void>,
    runExclusive: (email: string, action: () => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const client = this.clientFactory();
    let verification: Awaited<ReturnType<typeof client.auth.verifyOtp>>;
    try {
      verification = await client.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      });
    } catch {
      throw new IdentityProviderUnavailableError();
    }
    if (verification.error !== null) {
      if (isInvalidProof(verification.error))
        throw new InvalidRecoveryTokenError();
      throw new IdentityProviderUnavailableError();
    }
    const user = recoveryUserSchema.safeParse(verification.data.user);
    if (!user.success) throw new IdentityProviderUnavailableError();

    await runExclusive(user.data.email, async () => {
      // The same per-email lock covers login authentication and session issuance.
      // Revoke before changing the credential so a database outage fails closed.
      await revokeSessions(user.data.id);
      let result: Awaited<ReturnType<typeof client.auth.updateUser>>;
      try {
        result = await client.auth.updateUser({ password });
      } catch {
        throw new IdentityProviderUnavailableError();
      }
      if (result.error !== null) throw new IdentityProviderUnavailableError();
      await revokeSessions(user.data.id);
    });
  }
}
