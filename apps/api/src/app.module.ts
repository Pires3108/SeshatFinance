import {
  ChangeOwnedTransactionLifecycleUseCase,
  AuthenticateUserUseCase,
  ChangeOwnedTransferLifecycleUseCase,
  ChangeOwnedAccountLifecycleUseCase,
  CreateBalanceAdjustmentUseCase,
  ListOwnedBalanceAdjustmentsUseCase,
  CreateCreditCardUseCase,
  CreateManualExchangeQuoteUseCase,
  CorrectOwnedManualExchangeQuoteUseCase,
  GetOwnedManualExchangeQuoteUseCase,
  ListOwnedManualExchangeQuotesUseCase,
  CreateFamilyGroupUseCase,
  GetOwnedCreditCardUseCase,
  GetOwnedTransferUseCase,
  ListOwnedTransfersUseCase,
  ListOwnedCreditCardsUseCase,
  ListOwnFamilyGroupsUseCase,
  CreateCategoryUseCase,
  DeleteOwnedCategoryUseCase,
  GetOwnedCategoryUseCase,
  CreateCostCenterUseCase,
  DeleteOwnedCostCenterUseCase,
  GetOwnedCostCenterUseCase,
  CreateTagUseCase,
  DeleteOwnedTagUseCase,
  GetOwnedTagUseCase,
  CreateAccountUseCase,
  CreateTransactionUseCase,
  CreateTransferUseCase,
  GetOwnedAccountUseCase,
  GetOwnedAccountBalanceUseCase,
  GetOwnedBalanceSummaryUseCase,
  GetOwnedTransactionUseCase,
  GetOwnedTransactionClassificationUseCase,
  ListOwnedTransactionTagsUseCase,
  ListOwnedTransactionsBetweenUseCase,
  ListOwnedCategoriesUseCase,
  ListOwnedCostCentersUseCase,
  ListOwnedTagsUseCase,
  ListOwnedAccountsUseCase,
  ListOwnedAccountTransactionsUseCase,
  ListInvestmentTypesUseCase,
  ListDefaultAccountTypesUseCase,
  RegisterUserUseCase,
  OpaqueSessionService,
  ConfirmRegistrationUseCase,
  ResendRegistrationConfirmationUseCase,
  ResolveAuthenticatedActorUseCase,
  RequestPasswordRecoveryUseCase,
  CompletePasswordRecoveryUseCase,
  RenameOwnedCategoryUseCase,
  SetOwnedCategoryArchivedUseCase,
  RenameOwnedCostCenterUseCase,
  SetOwnedCostCenterArchivedUseCase,
  RenameOwnedTagUseCase,
  SetOwnedTagArchivedUseCase,
  SetOwnedTransactionTagsUseCase,
  SetOwnedTransactionClassificationUseCase,
  GetOwnUserProfileUseCase,
  UpdateOwnUserProfileUseCase,
  UpdateOwnedAccountDetailsUseCase,
  UpdateOwnedTransactionUseCase,
  type UserProfileRepository,
  type OpaqueSessionRepository,
  type AccountRepository,
  type OwnedBalanceSummaryAccountRepository,
  type AccountTransactionBalanceRepository,
  type BalanceAdjustmentRepository,
  type BalanceAdjustmentHistoryRepository,
  type CreditCardRepository,
  type ManualExchangeQuoteRepository,
  type FamilyGroupRepository,
  type CategoryRepository,
  type CostCenterRepository,
  type TagRepository,
  type TransactionRepository,
  type TransactionFinancialLinkRepository,
  type TransactionTimelineRepository,
  type TransactionTagRepository,
  type TransactionClassificationRepository,
  type TransferRepository,
  type TransferLifecycleRepository,
  type TransferReadRepository,
} from '@seshat/application';
import { Module } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import {
  PrismaConfirmedIdentityProfileRepository,
  PrismaLoginAttemptRepository,
  PrismaOriginAttemptRepository,
  PrismaRecoveryRequestAttemptRepository,
} from '@seshat/database';

import { AccountController } from './accounts/account.controller.js';
import { AccountBalanceController } from './accounts/account-balance.controller.js';
import { AccountTypeController } from './accounts/account-type.controller.js';
import { LazyAccountRepository } from './accounts/lazy-account-repository.js';
import { BalanceAdjustmentController } from './adjustments/balance-adjustment.controller.js';
import { LazyBalanceAdjustmentRepository } from './adjustments/lazy-balance-adjustment-repository.js';
import { CreditCardController } from './cards/credit-card.controller.js';
import { LazyCreditCardRepository } from './cards/lazy-credit-card-repository.js';
import { FamilyGroupController } from './family/family-group.controller.js';
import { LazyFamilyGroupRepository } from './family/lazy-family-group-repository.js';
import { AuthConfiguration } from './auth/auth-configuration.js';
import { HibpPasswordSafetyChecker } from './auth/hibp-password-safety.checker.js';
import { CryptoOpaqueSessionTokens } from './auth/crypto-opaque-session-tokens.js';
import { LazyOpaqueSessionRepository } from './auth/lazy-opaque-session-repository.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthenticatedActorContext } from './auth/authenticated-actor-context.js';
import { BearerAuthGuard } from './auth/bearer-auth.guard.js';
import { PasswordRecoveryController } from './auth/password-recovery.controller.js';
import { SupabaseIdentityRegistrationGateway } from './auth/supabase-identity-registration.gateway.js';
import { SupabaseIdentityAuthenticationGateway } from './auth/supabase-identity-authentication.gateway.js';
import { SessionController } from './auth/session.controller.js';
import { SupabaseRegistrationConfirmationGateway } from './auth/supabase-registration-confirmation.gateway.js';
import { SupabaseRegistrationConfirmationResendGateway } from './auth/supabase-registration-confirmation-resend.gateway.js';
import { RegistrationIntentPruner } from './auth/registration-intent-pruner.js';
import { RecoveryRequestAttemptPruner } from './auth/recovery-request-attempt-pruner.js';
import { SupabaseIdentityTokenVerifier } from './auth/supabase-identity-token-verifier.js';
import { SupabasePasswordRecoveryGateway } from './auth/supabase-password-recovery.gateway.js';
import { SupabasePasswordRecoveryCompletionGateway } from './auth/supabase-password-recovery-completion.gateway.js';
import { CategoryController } from './classifications/category.controller.js';
import { CostCenterController } from './classifications/cost-center.controller.js';
import { LazyCategoryRepository } from './classifications/lazy-category-repository.js';
import { LazyCostCenterRepository } from './classifications/lazy-cost-center-repository.js';
import { LazyTagRepository } from './classifications/lazy-tag-repository.js';
import { TagController } from './classifications/tag.controller.js';
import { HealthController } from './health/health.controller.js';
import { DatabaseReadiness } from './health/database-readiness.js';
import { InvestmentTypeController } from './investments/investment-type.controller.js';
import { LazyManualExchangeQuoteRepository } from './money/lazy-manual-exchange-quote-repository.js';
import { ManualExchangeQuoteController } from './money/manual-exchange-quote.controller.js';
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
import { LazyTransferRepository } from './transfers/lazy-transfer-repository.js';
import { TransferController } from './transfers/transfer.controller.js';
import { LazyUserProfileRepository } from './users/lazy-user-profile-repository.js';
import { UserProfileController } from './users/user-profile.controller.js';

@Module({
  controllers: [
    AccountBalanceController,
    AccountController,
    AccountTypeController,
    BalanceAdjustmentController,
    CreditCardController,
    FamilyGroupController,
    AuthController,
    CategoryController,
    CostCenterController,
    HealthController,
    InvestmentTypeController,
    ManualExchangeQuoteController,
    PasswordRecoveryController,
    SessionController,
    TagController,
    TransactionController,
    TransactionClassificationController,
    TransactionTagController,
    TransferController,
    UserProfileController,
  ],
  providers: [
    RegistrationIntentPruner,
    RecoveryRequestAttemptPruner,
    {
      provide: ListDefaultAccountTypesUseCase,
      useFactory: (): ListDefaultAccountTypesUseCase =>
        new ListDefaultAccountTypesUseCase(),
    },
    {
      provide: ListInvestmentTypesUseCase,
      useFactory: (): ListInvestmentTypesUseCase =>
        new ListInvestmentTypesUseCase(),
    },
    AuthConfiguration,
    HibpPasswordSafetyChecker,
    AuthenticatedActorContext,
    BearerAuthGuard,
    CorrelationContext,
    DatabaseReadiness,
    PrivacySafeLogger,
    LazyPrismaClient,
    LazyOpaqueSessionRepository,
    LazyAccountRepository,
    LazyBalanceAdjustmentRepository,
    LazyCreditCardRepository,
    LazyManualExchangeQuoteRepository,
    LazyFamilyGroupRepository,
    LazyCategoryRepository,
    LazyCostCenterRepository,
    LazyTagRepository,
    LazyTransactionRepository,
    LazyTransactionClassificationRepository,
    LazyTransactionTagRepository,
    LazyTransferRepository,
    LazyUserProfileRepository,
    {
      inject: [LazyManualExchangeQuoteRepository],
      provide: CreateManualExchangeQuoteUseCase,
      useFactory: (
        quotes: ManualExchangeQuoteRepository,
      ): CreateManualExchangeQuoteUseCase =>
        new CreateManualExchangeQuoteUseCase(
          quotes,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyOpaqueSessionRepository],
      provide: OpaqueSessionService,
      useFactory: (sessions: OpaqueSessionRepository): OpaqueSessionService =>
        new OpaqueSessionService(
          sessions,
          new CryptoOpaqueSessionTokens(),
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyManualExchangeQuoteRepository],
      provide: CorrectOwnedManualExchangeQuoteUseCase,
      useFactory: (
        quotes: ManualExchangeQuoteRepository,
      ): CorrectOwnedManualExchangeQuoteUseCase =>
        new CorrectOwnedManualExchangeQuoteUseCase(
          quotes,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyManualExchangeQuoteRepository],
      provide: GetOwnedManualExchangeQuoteUseCase,
      useFactory: (
        quotes: ManualExchangeQuoteRepository,
      ): GetOwnedManualExchangeQuoteUseCase =>
        new GetOwnedManualExchangeQuoteUseCase(quotes),
    },
    {
      inject: [LazyManualExchangeQuoteRepository],
      provide: ListOwnedManualExchangeQuotesUseCase,
      useFactory: (
        quotes: ManualExchangeQuoteRepository,
      ): ListOwnedManualExchangeQuotesUseCase =>
        new ListOwnedManualExchangeQuotesUseCase(quotes),
    },
    {
      inject: [LazyFamilyGroupRepository],
      provide: CreateFamilyGroupUseCase,
      useFactory: (groups: FamilyGroupRepository): CreateFamilyGroupUseCase =>
        new CreateFamilyGroupUseCase(
          groups,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyFamilyGroupRepository],
      provide: ListOwnFamilyGroupsUseCase,
      useFactory: (groups: FamilyGroupRepository): ListOwnFamilyGroupsUseCase =>
        new ListOwnFamilyGroupsUseCase(groups),
    },
    {
      inject: [LazyAccountRepository, LazyCreditCardRepository],
      provide: CreateCreditCardUseCase,
      useFactory: (
        accounts: AccountRepository,
        cards: CreditCardRepository,
      ): CreateCreditCardUseCase =>
        new CreateCreditCardUseCase(
          accounts,
          cards,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyCreditCardRepository],
      provide: GetOwnedCreditCardUseCase,
      useFactory: (cards: CreditCardRepository): GetOwnedCreditCardUseCase =>
        new GetOwnedCreditCardUseCase(cards),
    },
    {
      inject: [LazyCreditCardRepository],
      provide: ListOwnedCreditCardsUseCase,
      useFactory: (cards: CreditCardRepository): ListOwnedCreditCardsUseCase =>
        new ListOwnedCreditCardsUseCase(cards),
    },
    {
      inject: [
        LazyAccountRepository,
        LazyTransactionRepository,
        LazyBalanceAdjustmentRepository,
      ],
      provide: CreateBalanceAdjustmentUseCase,
      useFactory: (
        accounts: AccountRepository,
        transactions: TransactionRepository,
        adjustments: BalanceAdjustmentRepository,
      ): CreateBalanceAdjustmentUseCase =>
        new CreateBalanceAdjustmentUseCase(
          accounts,
          transactions,
          adjustments,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyAccountRepository, LazyBalanceAdjustmentRepository],
      provide: ListOwnedBalanceAdjustmentsUseCase,
      useFactory: (
        accounts: AccountRepository,
        adjustments: BalanceAdjustmentHistoryRepository,
      ): ListOwnedBalanceAdjustmentsUseCase =>
        new ListOwnedBalanceAdjustmentsUseCase(accounts, adjustments),
    },
    {
      inject: [LazyAccountRepository, LazyTransferRepository],
      provide: CreateTransferUseCase,
      useFactory: (
        accounts: AccountRepository,
        transfers: TransferRepository,
      ): CreateTransferUseCase =>
        new CreateTransferUseCase(
          accounts,
          transfers,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyTransferRepository],
      provide: ChangeOwnedTransferLifecycleUseCase,
      useFactory: (
        transfers: TransferLifecycleRepository,
      ): ChangeOwnedTransferLifecycleUseCase =>
        new ChangeOwnedTransferLifecycleUseCase(
          transfers,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyTransferRepository],
      provide: GetOwnedTransferUseCase,
      useFactory: (
        transfers: TransferReadRepository,
      ): GetOwnedTransferUseCase => new GetOwnedTransferUseCase(transfers),
    },
    {
      inject: [LazyTransferRepository],
      provide: ListOwnedTransfersUseCase,
      useFactory: (
        transfers: TransferReadRepository,
      ): ListOwnedTransfersUseCase => new ListOwnedTransfersUseCase(transfers),
    },
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
      inject: [LazyCostCenterRepository],
      provide: GetOwnedCostCenterUseCase,
      useFactory: (
        costCenters: CostCenterRepository,
      ): GetOwnedCostCenterUseCase =>
        new GetOwnedCostCenterUseCase(costCenters),
    },
    {
      inject: [LazyCostCenterRepository],
      provide: SetOwnedCostCenterArchivedUseCase,
      useFactory: (
        costCenters: CostCenterRepository,
      ): SetOwnedCostCenterArchivedUseCase =>
        new SetOwnedCostCenterArchivedUseCase(costCenters, new SystemClock()),
    },
    {
      inject: [LazyCostCenterRepository],
      provide: DeleteOwnedCostCenterUseCase,
      useFactory: (
        costCenters: CostCenterRepository,
      ): DeleteOwnedCostCenterUseCase =>
        new DeleteOwnedCostCenterUseCase(costCenters),
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
      inject: [LazyTagRepository],
      provide: GetOwnedTagUseCase,
      useFactory: (tags: TagRepository): GetOwnedTagUseCase =>
        new GetOwnedTagUseCase(tags),
    },
    {
      inject: [LazyTagRepository],
      provide: SetOwnedTagArchivedUseCase,
      useFactory: (tags: TagRepository): SetOwnedTagArchivedUseCase =>
        new SetOwnedTagArchivedUseCase(tags, new SystemClock()),
    },
    {
      inject: [LazyTagRepository],
      provide: DeleteOwnedTagUseCase,
      useFactory: (tags: TagRepository): DeleteOwnedTagUseCase =>
        new DeleteOwnedTagUseCase(tags),
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
      provide: GetOwnedCategoryUseCase,
      useFactory: (categories: CategoryRepository): GetOwnedCategoryUseCase =>
        new GetOwnedCategoryUseCase(categories),
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
      inject: [LazyCategoryRepository],
      provide: SetOwnedCategoryArchivedUseCase,
      useFactory: (
        categories: CategoryRepository,
      ): SetOwnedCategoryArchivedUseCase =>
        new SetOwnedCategoryArchivedUseCase(categories, new SystemClock()),
    },
    {
      inject: [LazyCategoryRepository],
      provide: DeleteOwnedCategoryUseCase,
      useFactory: (
        categories: CategoryRepository,
      ): DeleteOwnedCategoryUseCase =>
        new DeleteOwnedCategoryUseCase(categories),
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
        transactions: TransactionRepository &
          TransactionFinancialLinkRepository,
        categories: CategoryRepository,
        costCenters: CostCenterRepository,
        classifications: TransactionClassificationRepository,
      ): SetOwnedTransactionClassificationUseCase =>
        new SetOwnedTransactionClassificationUseCase(
          transactions,
          transactions,
          categories,
          costCenters,
          classifications,
          new SystemClock(),
          new SystemIdentifierGenerator(),
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
        transactions: TransactionRepository &
          TransactionFinancialLinkRepository,
        tags: TagRepository,
        assignments: TransactionTagRepository,
      ): SetOwnedTransactionTagsUseCase =>
        new SetOwnedTransactionTagsUseCase(
          transactions,
          transactions,
          tags,
          assignments,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
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
        transactions: TransactionRepository &
          TransactionFinancialLinkRepository,
        accounts: AccountRepository,
      ): UpdateOwnedTransactionUseCase =>
        new UpdateOwnedTransactionUseCase(
          transactions,
          transactions,
          accounts,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyTransactionRepository],
      provide: ChangeOwnedTransactionLifecycleUseCase,
      useFactory: (
        transactions: TransactionRepository &
          TransactionFinancialLinkRepository,
      ): ChangeOwnedTransactionLifecycleUseCase =>
        new ChangeOwnedTransactionLifecycleUseCase(
          transactions,
          transactions,
          new SystemClock(),
          new SystemIdentifierGenerator(),
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
        transactions: AccountTransactionBalanceRepository,
      ): GetOwnedAccountBalanceUseCase =>
        new GetOwnedAccountBalanceUseCase(accounts, transactions),
    },
    {
      inject: [LazyAccountRepository, GetOwnedAccountBalanceUseCase],
      provide: GetOwnedBalanceSummaryUseCase,
      useFactory: (
        accounts: OwnedBalanceSummaryAccountRepository,
        balances: GetOwnedAccountBalanceUseCase,
      ): GetOwnedBalanceSummaryUseCase =>
        new GetOwnedBalanceSummaryUseCase(accounts, balances),
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
        new UpdateOwnedAccountDetailsUseCase(
          accounts,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
    },
    {
      inject: [LazyAccountRepository],
      provide: ChangeOwnedAccountLifecycleUseCase,
      useFactory: (
        accounts: AccountRepository,
      ): ChangeOwnedAccountLifecycleUseCase =>
        new ChangeOwnedAccountLifecycleUseCase(
          accounts,
          new SystemClock(),
          new SystemIdentifierGenerator(),
        ),
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
      inject: [AuthConfiguration, LazyPrismaClient],
      provide: ResolveAuthenticatedActorUseCase,
      useFactory: (
        configuration: AuthConfiguration,
        prisma: LazyPrismaClient,
      ): ResolveAuthenticatedActorUseCase =>
        new ResolveAuthenticatedActorUseCase(
          new SupabaseIdentityTokenVerifier(
            () => {
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
            },
            new PrismaConfirmedIdentityProfileRepository(
              () => prisma.get(),
              () => configuration.readIntentHmacKey(),
            ),
            new SystemClock(),
          ),
        ),
    },
    {
      inject: [AuthConfiguration, LazyPrismaClient, HibpPasswordSafetyChecker],
      provide: RegisterUserUseCase,
      useFactory: (
        configuration: AuthConfiguration,
        prisma: LazyPrismaClient,
        passwords: HibpPasswordSafetyChecker,
      ): RegisterUserUseCase =>
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
          new PrismaConfirmedIdentityProfileRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
          passwords,
        ),
    },
    {
      inject: [AuthConfiguration, LazyPrismaClient],
      provide: ConfirmRegistrationUseCase,
      useFactory: (
        configuration: AuthConfiguration,
        prisma: LazyPrismaClient,
      ): ConfirmRegistrationUseCase =>
        new ConfirmRegistrationUseCase(
          new SupabaseRegistrationConfirmationGateway(() => {
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
          new PrismaConfirmedIdentityProfileRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
          new SystemClock(),
        ),
    },
    {
      inject: [
        AuthConfiguration,
        LazyPrismaClient,
        ResolveAuthenticatedActorUseCase,
      ],
      provide: AuthenticateUserUseCase,
      useFactory: (
        configuration: AuthConfiguration,
        prisma: LazyPrismaClient,
        resolveActor: ResolveAuthenticatedActorUseCase,
      ): AuthenticateUserUseCase =>
        new AuthenticateUserUseCase(
          new SupabaseIdentityAuthenticationGateway(
            () => {
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
            },
            (token) => resolveActor.execute(token),
          ),
          new PrismaLoginAttemptRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
          new SystemClock(),
          new PrismaOriginAttemptRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
        ),
    },
    {
      inject: [AuthConfiguration],
      provide: ResendRegistrationConfirmationUseCase,
      useFactory: (
        configuration: AuthConfiguration,
      ): ResendRegistrationConfirmationUseCase =>
        new ResendRegistrationConfirmationUseCase(
          new SupabaseRegistrationConfirmationResendGateway(() => {
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
      inject: [AuthConfiguration, LazyPrismaClient],
      provide: RequestPasswordRecoveryUseCase,
      useFactory: (
        configuration: AuthConfiguration,
        prisma: LazyPrismaClient,
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
          new PrismaRecoveryRequestAttemptRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
          new SystemClock(),
          new PrismaOriginAttemptRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
        ),
    },
    {
      inject: [
        AuthConfiguration,
        OpaqueSessionService,
        LazyPrismaClient,
        HibpPasswordSafetyChecker,
      ],
      provide: CompletePasswordRecoveryUseCase,
      useFactory: (
        configuration: AuthConfiguration,
        sessions: OpaqueSessionService,
        prisma: LazyPrismaClient,
        passwords: HibpPasswordSafetyChecker,
      ): CompletePasswordRecoveryUseCase =>
        new CompletePasswordRecoveryUseCase(
          new SupabasePasswordRecoveryCompletionGateway(() => {
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
          sessions,
          new PrismaLoginAttemptRepository(
            () => prisma.get(),
            () => configuration.readIntentHmacKey(),
          ),
          passwords,
        ),
    },
  ],
})
export class AppModule {}
