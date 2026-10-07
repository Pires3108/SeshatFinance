import { z } from 'zod';

const authEnvironmentSchema = z.object({
  AUTH_CONFIRMATION_REDIRECT_URL: z.url(),
  AUTH_FAMILY_INVITATION_REDIRECT_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_URL: z.url(),
});

const passwordRecoveryEnvironmentSchema = z.object({
  AUTH_PASSWORD_RECOVERY_REDIRECT_URL: z.url(),
});

export type AuthConfigurationValues = Readonly<{
  confirmationRedirectUrl: string;
  familyInvitationRedirectUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
}>;

export class AuthConfiguration {
  public read(): AuthConfigurationValues {
    const values = authEnvironmentSchema.parse(process.env);
    return {
      confirmationRedirectUrl: values.AUTH_CONFIRMATION_REDIRECT_URL,
      familyInvitationRedirectUrl: values.AUTH_FAMILY_INVITATION_REDIRECT_URL,
      supabasePublishableKey: values.SUPABASE_PUBLISHABLE_KEY,
      supabaseServiceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrl: values.SUPABASE_URL,
    };
  }

  public readPasswordRecoveryRedirectUrl(): string {
    return passwordRecoveryEnvironmentSchema.parse(process.env)
      .AUTH_PASSWORD_RECOVERY_REDIRECT_URL;
  }
}
