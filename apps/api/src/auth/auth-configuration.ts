import { z } from 'zod';

const authEnvironmentSchema = z.object({
  AUTH_CONFIRMATION_REDIRECT_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_URL: z.url(),
});

export type AuthConfigurationValues = Readonly<{
  confirmationRedirectUrl: string;
  supabasePublishableKey: string;
  supabaseUrl: string;
}>;

export class AuthConfiguration {
  public read(): AuthConfigurationValues {
    const values = authEnvironmentSchema.parse(process.env);
    return {
      confirmationRedirectUrl: values.AUTH_CONFIRMATION_REDIRECT_URL,
      supabasePublishableKey: values.SUPABASE_PUBLISHABLE_KEY,
      supabaseUrl: values.SUPABASE_URL,
    };
  }
}
