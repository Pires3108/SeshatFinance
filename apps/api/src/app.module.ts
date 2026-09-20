import {
  RegisterUserUseCase,
  ResolveAuthenticatedActorUseCase,
  RequestPasswordRecoveryUseCase,
  GetOwnUserProfileUseCase,
  UpdateOwnUserProfileUseCase,
  type UserProfileRepository,
} from '@seshat/application';
import { Module } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import { AuthConfiguration } from './auth/auth-configuration.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthenticatedActorContext } from './auth/authenticated-actor-context.js';
import { BearerAuthGuard } from './auth/bearer-auth.guard.js';
import { PasswordRecoveryController } from './auth/password-recovery.controller.js';
import { SupabaseIdentityRegistrationGateway } from './auth/supabase-identity-registration.gateway.js';
import { SupabaseIdentityTokenVerifier } from './auth/supabase-identity-token-verifier.js';
import { SupabasePasswordRecoveryGateway } from './auth/supabase-password-recovery.gateway.js';
import { HealthController } from './health/health.controller.js';
import { CorrelationContext } from './platform/correlation-context.js';
import { PrivacySafeLogger } from './platform/privacy-safe-logger.js';
import { SystemClock } from './platform/system-clock.js';
import { LazyUserProfileRepository } from './users/lazy-user-profile-repository.js';
import { UserProfileController } from './users/user-profile.controller.js';

@Module({
  controllers: [
    AuthController,
    HealthController,
    PasswordRecoveryController,
    UserProfileController,
  ],
  providers: [
    AuthConfiguration,
    AuthenticatedActorContext,
    BearerAuthGuard,
    CorrelationContext,
    PrivacySafeLogger,
    LazyUserProfileRepository,
    {
      inject: [LazyUserProfileRepository],
      provide: GetOwnUserProfileUseCase,
      useFactory: (profiles: UserProfileRepository): GetOwnUserProfileUseCase =>
        new GetOwnUserProfileUseCase(profiles),
    },
    {
      inject: [LazyUserProfileRepository],
      provide: UpdateOwnUserProfileUseCase,
      useFactory: (
        profiles: UserProfileRepository,
      ): UpdateOwnUserProfileUseCase =>
        new UpdateOwnUserProfileUseCase(profiles, new SystemClock()),
    },
    {
      inject: [AuthConfiguration],
      provide: ResolveAuthenticatedActorUseCase,
      useFactory: (
        configuration: AuthConfiguration,
      ): ResolveAuthenticatedActorUseCase =>
        new ResolveAuthenticatedActorUseCase(
          new SupabaseIdentityTokenVerifier(() => {
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
