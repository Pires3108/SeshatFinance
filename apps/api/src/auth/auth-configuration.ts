import { z } from 'zod';

const authEnvironmentSchema = z.object({
  AUTH_CONFIRMATION_REDIRECT_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_URL: z.url(),
});

const passwordRecoveryEnvironmentSchema = z.object({
  AUTH_PASSWORD_RECOVERY_REDIRECT_URL: z.url(),
});
const intentHashEnvironmentSchema = z.object({
  AUTH_REGISTRATION_INTENT_HMAC_KEY: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
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

  public readPasswordRecoveryRedirectUrl(): string {
    return passwordRecoveryEnvironmentSchema.parse(process.env)
      .AUTH_PASSWORD_RECOVERY_REDIRECT_URL;
  }

  public readIntentHmacKey(): string {
    return intentHashEnvironmentSchema.parse(process.env)
      .AUTH_REGISTRATION_INTENT_HMAC_KEY;
  }
}
