import {
  BRAZIL_HOLIDAY_DATASET_VERSION,
  CivilDate,
  FinancialAuditEvent,
  Money,
  type CardClosingBoundary,
  type CardCycle,
  type CreditCard,
} from '@seshat/domain';

import {
  resolveHolidayPredicate,
  type HolidaySettingsRepository,
} from '../calendar/holiday-settings.js';
import { readCivilDate } from '../ports/civil-date.js';
import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';
import type { CreditCardRepository } from './create-credit-card.js';

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

export class CreditCardNotFoundError extends Error {
  public constructor() {
    super('Owned credit card was not found.');
    this.name = 'CreditCardNotFoundError';
  }
}

export class CreditCardVersionConflictError extends Error {
  public constructor() {
    super('Credit card was modified concurrently.');
    this.name = 'CreditCardVersionConflictError';
  }
}

export type UpdateCreditCardCommand = Readonly<{
  actorId: string;
  cardId: string;
  expectedVersion: number;
  brand: string;
  closingBoundary: CardClosingBoundary;
  closingDay: number;
  dueDay: number;
  limit: string;
  name: string;
}>;

/**
 * Changes organizational card settings with optimistic concurrency and an
 * audit event. Closed invoices keep their own date snapshot (US-040).
 */
export class UpdateCreditCardUseCase {
  public constructor(
    private readonly cards: CreditCardRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: UpdateCreditCardCommand): Promise<CreditCard> {
    const current = await this.cards.findByIdForOwner(
      command.cardId,
      command.actorId,
    );
    if (current === null) throw new CreditCardNotFoundError();
    if (current.version !== command.expectedVersion) {
      throw new CreditCardVersionConflictError();
    }
    const updated = current.update({
      brand: command.brand,
      closingBoundary: command.closingBoundary,
      closingDay: command.closingDay,
      dueDay: command.dueDay,
      limit: Money.fromDecimal(command.limit, current.limit.currency),
      name: command.name,
    });
    const saved = await this.cards.update(
      updated,
      current.version,
      FinancialAuditEvent.create({
        action: 'updated',
        actorId: command.actorId,
        id: this.identifiers.generate(),
        occurredAt: this.clock.now(),
        ownerId: command.actorId,
        resourceId: updated.id,
        resourceType: 'credit-card',
      }),
    );
    if (!saved) throw new CreditCardVersionConflictError();
    return updated;
  }
}

export type CreditCardCycleView = Readonly<{
  card: CreditCard;
  cycle: CardCycle;
  /** Civil date, in the holder's time zone, used to pick the cycle. */
  purchaseDate: CivilDate;
  timeZone: string;
  holidayDatasetVersion: string;
}>;

/** Resolves cycles with the holder's time zone and holiday location. */
export class CardCycleResolver {
  public constructor(
    private readonly profiles: UserProfileRepository,
    private readonly holidays: HolidaySettingsRepository,
  ) {}

  public async resolve(
    card: CreditCard,
    instant: Date,
  ): Promise<Omit<CreditCardCycleView, 'card'>> {
    const profile = await this.profiles.findById(card.ownerId);
    const timeZone = profile?.timeZone ?? DEFAULT_TIME_ZONE;
    const purchaseDate = CivilDate.parse(
      readCivilDate({ now: () => instant }, timeZone),
    );
    const isHoliday = await resolveHolidayPredicate(
      this.holidays,
      card.ownerId,
    );
    return {
      cycle: card.cycleSchedule.cycleFor(purchaseDate, isHoliday),
      holidayDatasetVersion: BRAZIL_HOLIDAY_DATASET_VERSION,
      purchaseDate,
      timeZone,
    };
  }
}

/** The single cycle that contains a purchase made at `at` (default: now). */
export class GetCreditCardCycleUseCase {
  private readonly resolver: CardCycleResolver;

  public constructor(
    private readonly cards: CreditCardRepository,
    profiles: UserProfileRepository,
    holidays: HolidaySettingsRepository,
    private readonly clock: Clock,
  ) {
    this.resolver = new CardCycleResolver(profiles, holidays);
  }

  public async execute(
    query: Readonly<{ actorId: string; cardId: string; at?: Date }>,
  ): Promise<CreditCardCycleView> {
    const card = await this.cards.findByIdForOwner(query.cardId, query.actorId);
    if (card === null) throw new CreditCardNotFoundError();
    return {
      card,
      ...(await this.resolver.resolve(card, query.at ?? this.clock.now())),
    };
  }
}
