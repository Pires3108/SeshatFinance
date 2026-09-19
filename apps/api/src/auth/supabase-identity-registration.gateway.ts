import type {
  IdentityRegistrationGateway,
  RegisterUserCommand,
} from '@seshat/application';
import type { SupabaseClient } from '@supabase/supabase-js';

export class IdentityRegistrationError extends Error {
  public constructor() {
    super('Identity registration was not accepted.');
    this.name = 'IdentityRegistrationError';
  }
}

export class SupabaseIdentityRegistrationGateway implements IdentityRegistrationGateway {
  public constructor(private readonly client: SupabaseClient) {}

  public async register(command: RegisterUserCommand): Promise<void> {
    const { error } = await this.client.auth.signUp({
      email: command.email,
      password: command.password,
      options: {
        data: { display_name: command.displayName },
        emailRedirectTo: command.confirmationRedirectUrl,
      },
    });

    if (error) {
      throw new IdentityRegistrationError();
    }
  }
}
