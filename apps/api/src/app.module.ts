import {
  ChangeOwnedTransactionLifecycleUseCase,
  ChangeOwnedAccountLifecycleUseCase,
  CreateCategoryUseCase,
  CreateCostCenterUseCase,
  CreateTagUseCase,
  CreateAccountUseCase,
  CreateTransactionUseCase,
  GetOwnedAccountUseCase,
  GetOwnedAccountBalanceUseCase,
  GetOwnedTransactionUseCase,
  GetOwnedTransactionClassificationUseCase,
  ListOwnedTransactionTagsUseCase,
  ListOwnedTransactionsBetweenUseCase,
  ListOwnedCategoriesUseCase,
  ListOwnedCostCentersUseCase,
  ListOwnedTagsUseCase,
  ListOwnedAccountsUseCase,
  ListOwnedAccountTransactionsUseCase,
  RegisterUserUseCase,
  ResolveAuthenticatedActorUseCase,
  RequestPasswordRecoveryUseCase,
  RenameOwnedCategoryUseCase,
  RenameOwnedCostCenterUseCase,
  RenameOwnedTagUseCase,
  SetOwnedTransactionTagsUseCase,
  SetOwnedTransactionClassificationUseCase,
  GetOwnUserProfileUseCase,
  UpdateOwnUserProfileUseCase,
  UpdateOwnedAccountDetailsUseCase,
  UpdateOwnedTransactionUseCase,
  type UserProfileRepository,
  type AccountRepository,
  type CategoryRepository,
  type CostCenterRepository,
  type TagRepository,
  type TransactionRepository,
  type TransactionTimelineRepository,
  type TransactionTagRepository,
  type TransactionClassificationRepository,
} from '@seshat/application';
import { Module } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import { AccountController } from './accounts/account.controller.js';
import { AccountBalanceController } from './accounts/account-balance.controller.js';
import { LazyAccountRepository } from './accounts/lazy-account-repository.js';
import { AuthConfiguration } from './auth/auth-configuration.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthenticatedActorContext } from './auth/authenticated-actor-context.js';
import { BearerAuthGuard } from './auth/bearer-auth.guard.js';
import { PasswordRecoveryController } from './auth/password-recovery.controller.js';
import { SupabaseIdentityRegistrationGateway } from './auth/supabase-identity-registration.gateway.js';
import { SupabaseIdentityTokenVerifier } from './auth/supabase-identity-token-verifier.js';
import { SupabasePasswordRecoveryGateway } from './auth/supabase-password-recovery.gateway.js';
import { CategoryController } from './classifications/category.controller.js';
import { CostCenterController } from './classifications/cost-center.controller.js';
import { LazyCategoryRepository } from './classifications/lazy-category-repository.js';
import { LazyCostCenterRepository } from './classifications/lazy-cost-center-repository.js';
import { LazyTagRepository } from './classifications/lazy-tag-repository.js';
import { TagController } from './classifications/tag.controller.js';
import { HealthController } from './health/health.controller.js';
import { CorrelationContext } from './platform/correlation-context.js';
import { PrivacySafeLogger } from './platform/privacy-safe-logger.js';
import { LazyPrismaClient } from './platform/lazy-prisma-client.js';
import { SystemClock } from './platform/system-clock.js';
import { SystemIdentifierGenerator } from './platform/system-identifier-generator.js';
import { LazyTransactionRepository } from './transactions/lazy-transaction-repository.js';
import { LazyTransactionClassificationRepository } from './transactions/lazy-transaction-classification-repository.js';
import { LazyTransactionTagRepository } from './transactions/lazy-transaction-tag-repository.js';
import { TransactionController } from './transactions/transaction.controller.js';
import { TransactionTagController } from './transactions/transaction-tag.controller.js';
import { TransactionClassificationController } from './transactions/transaction-classification.controller.js';
import { LazyUserProfileRepository } from './users/lazy-user-profile-repository.js';
import { UserProfileController } from './users/user-profile.controller.js';

@Module({
  controllers: [
    AccountBalanceController,
    AccountController,
    AuthController,
    CategoryController,
    CostCenterController,
    HealthController,
    PasswordRecoveryController,
    TagController,
    TransactionController,
    TransactionClassificationController,
    TransactionTagController,
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
    LazyCategoryRepository,
    LazyCostCenterRepository,
    LazyTagRepository,
    LazyTransactionRepository,
    LazyTransactionClassificationRepository,
    LazyTransactionTagRepository,
    LazyUserProfileRepository,
    {
      inject: [LazyCostCenterRepository],
      provide: CreateCostCenterUseCase,
      useFactory: (
        costCenters: CostCenterRepository,
      ): CreateCostCenterUseCase =>
        new CreateCostCenterUseCase(
          costCenters,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyCostCenterRepository],
      provide: ListOwnedCostCentersUseCase,
      useFactory: (
        costCenters: CostCenterRepository,
      ): ListOwnedCostCentersUseCase =>
        new ListOwnedCostCentersUseCase(costCenters),
    },
    {
      inject: [LazyCostCenterRepository],
      provide: RenameOwnedCostCenterUseCase,
      useFactory: (
        costCenters: CostCenterRepository,
      ): RenameOwnedCostCenterUseCase =>
        new RenameOwnedCostCenterUseCase(costCenters, new SystemClock()),
    },
    {
      inject: [LazyTagRepository],
      provide: CreateTagUseCase,
      useFactory: (tags: TagRepository): CreateTagUseCase =>
        new CreateTagUseCase(
          tags,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyTagRepository],
      provide: ListOwnedTagsUseCase,
      useFactory: (tags: TagRepository): ListOwnedTagsUseCase =>
        new ListOwnedTagsUseCase(tags),
    },
    {
      inject: [LazyTagRepository],
      provide: RenameOwnedTagUseCase,
      useFactory: (tags: TagRepository): RenameOwnedTagUseCase =>
        new RenameOwnedTagUseCase(tags, new SystemClock()),
    },
    {
      inject: [LazyCategoryRepository],
      provide: CreateCategoryUseCase,
      useFactory: (categories: CategoryRepository): CreateCategoryUseCase =>
        new CreateCategoryUseCase(
          categories,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyCategoryRepository],
      provide: ListOwnedCategoriesUseCase,
      useFactory: (
        categories: CategoryRepository,
      ): ListOwnedCategoriesUseCase =>
        new ListOwnedCategoriesUseCase(categories),
    },
    {
      inject: [LazyCategoryRepository],
      provide: RenameOwnedCategoryUseCase,
      useFactory: (
        categories: CategoryRepository,
      ): RenameOwnedCategoryUseCase =>
        new RenameOwnedCategoryUseCase(categories, new SystemClock()),
    },
    {
      inject: [
        LazyTransactionRepository,
        LazyTransactionClassificationRepository,
      ],
      provide: GetOwnedTransactionClassificationUseCase,
      useFactory: (
        transactions: TransactionRepository,
        classifications: TransactionClassificationRepository,
      ): GetOwnedTransactionClassificationUseCase =>
        new GetOwnedTransactionClassificationUseCase(
          transactions,
          classifications,
        ),
    },
    {
      inject: [
        LazyTransactionRepository,
        LazyCategoryRepository,
        LazyCostCenterRepository,
        LazyTransactionClassificationRepository,
      ],
      provide: SetOwnedTransactionClassificationUseCase,
      useFactory: (
        transactions: TransactionRepository,
        categories: CategoryRepository,
        costCenters: CostCenterRepository,
        classifications: TransactionClassificationRepository,
      ): SetOwnedTransactionClassificationUseCase =>
        new SetOwnedTransactionClassificationUseCase(
          transactions,
          categories,
          costCenters,
          classifications,
        ),
    },
    {
      inject: [LazyTransactionRepository, LazyTransactionTagRepository],
      provide: ListOwnedTransactionTagsUseCase,
      useFactory: (
        transactions: TransactionRepository,
        assignments: TransactionTagRepository,
      ): ListOwnedTransactionTagsUseCase =>
        new ListOwnedTransactionTagsUseCase(transactions, assignments),
    },
    {
      inject: [LazyTransactionRepository],
      provide: ListOwnedTransactionsBetweenUseCase,
      useFactory: (
        transactions: TransactionTimelineRepository,
      ): ListOwnedTransactionsBetweenUseCase =>
        new ListOwnedTransactionsBetweenUseCase(transactions),
    },
    {
      inject: [
        LazyTransactionRepository,
        LazyTagRepository,
        LazyTransactionTagRepository,
      ],
      provide: SetOwnedTransactionTagsUseCase,
      useFactory: (
        transactions: TransactionRepository,
        tags: TagRepository,
        assignments: TransactionTagRepository,
      ): SetOwnedTransactionTagsUseCase =>
        new SetOwnedTransactionTagsUseCase(transactions, tags, assignments),
    },
    {
      inject: [LazyTransactionRepository, LazyAccountRepository],
      provide: CreateTransactionUseCase,
      useFactory: (
        transactions: TransactionRepository,
        accounts: AccountRepository,
      ): CreateTransactionUseCase =>
        new CreateTransactionUseCase(
          transactions,
          accounts,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyTransactionRepository, LazyAccountRepository],
      provide: UpdateOwnedTransactionUseCase,
      useFactory: (
        transactions: TransactionRepository,
        accounts: AccountRepository,
      ): UpdateOwnedTransactionUseCase =>
        new UpdateOwnedTransactionUseCase(
          transactions,
          accounts,
          new SystemClock(),
        ),
    },
    {
      inject: [LazyTransactionRepository],
      provide: ChangeOwnedTransactionLifecycleUseCase,
      useFactory: (
        transactions: TransactionRepository,
      ): ChangeOwnedTransactionLifecycleUseCase =>
        new ChangeOwnedTransactionLifecycleUseCase(
          transactions,
          new SystemClock(),
        ),
    },
    {
      inject: [LazyTransactionRepository],
      provide: GetOwnedTransactionUseCase,
      useFactory: (
        transactions: TransactionRepository,
      ): GetOwnedTransactionUseCase =>
        new GetOwnedTransactionUseCase(transactions),
    },
    {
      inject: [LazyTransactionRepository, LazyAccountRepository],
      provide: ListOwnedAccountTransactionsUseCase,
      useFactory: (
        transactions: TransactionRepository,
        accounts: AccountRepository,
      ): ListOwnedAccountTransactionsUseCase =>
        new ListOwnedAccountTransactionsUseCase(transactions, accounts),
    },
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
      inject: [LazyAccountRepository, LazyTransactionRepository],
      provide: GetOwnedAccountBalanceUseCase,
      useFactory: (
        accounts: AccountRepository,
        transactions: TransactionRepository,
      ): GetOwnedAccountBalanceUseCase =>
        new GetOwnedAccountBalanceUseCase(accounts, transactions),
    },
    {
      inject: [LazyAccountRepository],
      provide: ListOwnedAccountsUseCase,
      useFactory: (accounts: AccountRepository): ListOwnedAccountsUseCase =>
        new ListOwnedAccountsUseCase(accounts),
    },
    {
      inject: [LazyAccountRepository],
      provide: UpdateOwnedAccountDetailsUseCase,
      useFactory: (
        accounts: AccountRepository,
      ): UpdateOwnedAccountDetailsUseCase =>
        new UpdateOwnedAccountDetailsUseCase(accounts, new SystemClock()),
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
