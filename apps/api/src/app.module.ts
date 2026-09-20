import {
  ChangeOwnedAccountLifecycleUseCase,
  CreateAccountUseCase,
  GetOwnedAccountUseCase,
  RegisterUserUseCase,
  ResolveAuthenticatedActorUseCase,
  RequestPasswordRecoveryUseCase,
  GetOwnUserProfileUseCase,
  UpdateOwnUserProfileUseCase,
  type UserProfileRepository,
  type AccountRepository,
} from '@seshat/application';
import { Module } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import { AccountController } from './accounts/account.controller.js';
import { LazyAccountRepository } from './accounts/lazy-account-repository.js';
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
import { LazyPrismaClient } from './platform/lazy-prisma-client.js';
import { SystemClock } from './platform/system-clock.js';
import { SystemIdentifierGenerator } from './platform/system-identifier-generator.js';
import { LazyUserProfileRepository } from './users/lazy-user-profile-repository.js';
import { UserProfileController } from './users/user-profile.controller.js';

@Module({
  controllers: [
    AccountController,
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
    LazyPrismaClient,
    LazyAccountRepository,
    LazyUserProfileRepository,
    {
      inject: [LazyAccountRepository],
      provide: CreateAccountUseCase,
      useFactory: (accounts: AccountRepository): CreateAccountUseCase =>
        new CreateAccountUseCase(
          accounts,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyAccountRepository],
      provide: GetOwnedAccountUseCase,
      useFactory: (accounts: AccountRepository): GetOwnedAccountUseCase =>
        new GetOwnedAccountUseCase(accounts),
    },
    {
      inject: [LazyAccountRepository],
      provide: ChangeOwnedAccountLifecycleUseCase,
      useFactory: (
        accounts: AccountRepository,
      ): ChangeOwnedAccountLifecycleUseCase =>
        new ChangeOwnedAccountLifecycleUseCase(accounts, new SystemClock()),
    },
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
