import {
  RegisterUserUseCase,
  RequestPasswordRecoveryUseCase,
} from '@seshat/application';
import { Module } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import { AuthConfiguration } from './auth/auth-configuration.js';
import { AuthController } from './auth/auth.controller.js';
import { PasswordRecoveryController } from './auth/password-recovery.controller.js';
import { SupabaseIdentityRegistrationGateway } from './auth/supabase-identity-registration.gateway.js';
import { SupabasePasswordRecoveryGateway } from './auth/supabase-password-recovery.gateway.js';
import { HealthController } from './health/health.controller.js';
import { CorrelationContext } from './platform/correlation-context.js';
import { PrivacySafeLogger } from './platform/privacy-safe-logger.js';

@Module({
  controllers: [AuthController, HealthController, PasswordRecoveryController],
  providers: [
    AuthConfiguration,
    CorrelationContext,
    PrivacySafeLogger,
    {
      inject: [AuthConfiguration],
      provide: RegisterUserUseCase,
      useFactory: (configuration: AuthConfiguration): RegisterUserUseCase =>
        new RegisterUserUseCase(
          new SupabaseIdentityRegistrationGateway(() => {
            const values = configuration.read();
            return createClient(
              values.supabaseUrl,
              values.supabasePublishableKey,
              {
                auth: {
                  autoRefreshToken: false,
                  detectSessionInUrl: false,
                  persistSession: false,
                },
              },
            );
          }),
        ),
    },
    {
      inject: [AuthConfiguration],
      provide: RequestPasswordRecoveryUseCase,
      useFactory: (
        configuration: AuthConfiguration,
      ): RequestPasswordRecoveryUseCase =>
        new RequestPasswordRecoveryUseCase(
          new SupabasePasswordRecoveryGateway(() => {
            const values = configuration.read();
            return createClient(
              values.supabaseUrl,
              values.supabasePublishableKey,
              {
                auth: {
                  autoRefreshToken: false,
                  detectSessionInUrl: false,
                  persistSession: false,
                },
              },
            );
          }),
        ),
    },
  ],
})
export class AppModule {}
