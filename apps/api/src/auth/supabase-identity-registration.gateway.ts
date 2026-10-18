import type {
  IdentityRegistrationGateway,
  RegisterUserCommand,
} from '@seshat/application';
import { PasswordRejectedError } from '@seshat/application';
import { z } from 'zod';

export type SupabaseRegistrationClient = Readonly<{
  auth: Readonly<{
    signUp(
      credentials: Readonly<{
        email: string;
        password: string;
        options: Readonly<{
          data: Readonly<{ display_name: string }>;
          emailRedirectTo: string;
        }>;
      }>,
    ): PromiseLike<
      Readonly<{
        data: Readonly<{
          user: Readonly<{
            id: string;
            identities?: readonly unknown[];
          }> | null;
        }>;
        error: unknown;
      }>
    >;
  }>;
}>;

export class IdentityRegistrationError extends Error {
  public constructor() {
    super('Identity registration was not accepted.');
    this.name = 'IdentityRegistrationError';
  }
}

export class SupabaseIdentityRegistrationGateway implements IdentityRegistrationGateway {
  public constructor(
    private readonly clientFactory: () => SupabaseRegistrationClient,
  ) {}

  public async register(command: RegisterUserCommand): Promise<string | null> {
    try {
      const { data, error } = await this.clientFactory().auth.signUp({
        email: command.email,
        password: command.password,
        options: {
          data: { display_name: command.displayName },
          emailRedirectTo: command.confirmationRedirectUrl,
        },
      });

      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'user_already_exists'
      )
        return null;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'weak_password'
      )
        throw new PasswordRejectedError();
      if (error) {
        throw new IdentityRegistrationError();
      }
      if (data.user === null || data.user.identities?.length === 0) return null;
      const id = z.uuid().safeParse(data.user.id);
      if (!id.success) throw new IdentityRegistrationError();
      return id.data;
    } catch (error) {
      if (error instanceof PasswordRejectedError) throw error;
      throw new IdentityRegistrationError();
    }
  }
}
