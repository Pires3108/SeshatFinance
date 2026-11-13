import {
  CreditCard,
  Currency,
  Money,
  type FinancialAuditEvent,
} from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_HOLIDAY_SETTINGS,
  type HolidaySettings,
  type HolidaySettingsRepository,
} from '../calendar/holiday-settings.js';
import type { UserProfileRepository } from '../users/update-own-user-profile.js';
import type { CreditCardRepository } from './create-credit-card.js';
import {
  CreditCardNotFoundError,
  CreditCardVersionConflictError,
  GetCreditCardCycleUseCase,
  UpdateCreditCardUseCase,
} from './manage-credit-card.js';

const ownerId = 'owner-id';
const brl = Currency.create('BRL', 2);
const clock = { now: () => new Date('2026-10-20T15:00:00.000Z') };

function card(): CreditCard {
  return CreditCard.create({
    brand: 'Visa',
    closingDay: 28,
    createdAt: new Date('2026-09-22T18:00:00.000Z'),
    dueDay: 7,
    id: 'card-id',
    limit: Money.fromDecimal('3500.00', brl),
    name: 'Cartão principal',
    ownerId,
    paymentAccountId: 'account-id',
  });
}

function cards(
  stored: CreditCard | null,
  updateResult = true,
): CreditCardRepository & {
  updates: { card: CreditCard; expected: number; event: FinancialAuditEvent }[];
} {
  const updates: {
    card: CreditCard;
    expected: number;
    event: FinancialAuditEvent;
  }[] = [];
  return {
    findByIdForOwner: (id, actorId) =>
      Promise.resolve(
        stored !== null && stored.id === id && stored.ownerId === actorId
          ? stored
          : null,
      ),
    insert: () => Promise.resolve(),
    listForOwner: () => Promise.resolve([]),
    update: (updated, expected, event) => {
      updates.push({ card: updated, event, expected });
      return Promise.resolve(updateResult);
    },
    updates,
  };
}

const changes = {
  actorId: ownerId,
  brand: 'Master',
  cardId: 'card-id',
  closingBoundary: 'closing-cycle',
  closingDay: 5,
  dueDay: 15,
  expectedVersion: 1,
  limit: '5000.00',
  name: 'Cartão viagem',
} as const;

describe('UpdateCreditCardUseCase', () => {
  const ids = (): { generate: () => string } => ({
    generate: () => 'audit-id',
  });

  it('saves the new version with an updated audit event', async () => {
    const repository = cards(card());

    const updated = await new UpdateCreditCardUseCase(
      repository,
      clock,
      ids(),
    ).execute(changes);

    expect(updated.version).toBe(2);
    expect(repository.updates).toHaveLength(1);
    expect(repository.updates[0]?.expected).toBe(1);
    expect(repository.updates[0]?.event.toSnapshot()).toMatchObject({
      action: 'updated',
      actorId: ownerId,
      resourceId: 'card-id',
      resourceType: 'credit-card',
    });
  });

  it('hides cards of other holders', async () => {
    await expect(
      new UpdateCreditCardUseCase(cards(card()), clock, ids()).execute({
        ...changes,
        actorId: 'intruder',
      }),
    ).rejects.toThrow(CreditCardNotFoundError);
  });

  it.each([
    ['a stale expected version', cards(card()), 3],
    ['a concurrent write', cards(card(), false), 1],
  ])('rejects %s', async (_label, repository, expectedVersion) => {
    await expect(
      new UpdateCreditCardUseCase(repository, clock, ids()).execute({
        ...changes,
        expectedVersion,
      }),
    ).rejects.toThrow(CreditCardVersionConflictError);
  });
});

describe('GetCreditCardCycleUseCase', () => {
  function profiles(timeZone: string | null): UserProfileRepository {
    return {
      changeTimeZone: () => Promise.resolve(null),
      findById: () =>
        Promise.resolve(
          timeZone === null
            ? null
            : {
                createdAt: clock.now(),
                displayName: null,
                id: ownerId,
                locale: 'pt-BR',
                presentationCurrency: 'BRL',
                refundPresentation: 'separate-income',
                timeZone,
                updatedAt: clock.now(),
                version: 1,
              },
        ),
      upsert: (profile) => Promise.resolve(profile),
    };
  }

  function holidays(settings: HolidaySettings): HolidaySettingsRepository {
    return {
      addDeclared: () => Promise.resolve(),
      findForOwner: () => Promise.resolve(settings),
      removeDeclared: () => Promise.resolve(false),
      saveLocation: () => Promise.resolve(),
    };
  }

  it('uses the civil date in the holder time zone to pick the cycle', async () => {
    // 2026-10-28T01:30Z is still 27/10 in São Paulo (UTC-3).
    const view = await new GetCreditCardCycleUseCase(
      cards(card()),
      profiles('America/Sao_Paulo'),
      holidays(EMPTY_HOLIDAY_SETTINGS),
      clock,
    ).execute({
      actorId: ownerId,
      at: new Date('2026-10-28T01:30:00.000Z'),
      cardId: 'card-id',
    });

    expect(view.purchaseDate.toString()).toBe('2026-10-27');
    expect(view.cycle.closesOn.toString()).toBe('2026-10-28');
    expect(view.timeZone).toBe('America/Sao_Paulo');
  });

  it('shifts the due date past holder-declared and state holidays', async () => {
    // Cycle closing 28/12/2026 is due 07/01/2027 (Thursday).
    const view = await new GetCreditCardCycleUseCase(
      cards(card()),
      profiles(null),
      holidays({
        declared: [
          {
            createdAt: clock.now(),
            day: 7,
            id: 'holiday-id',
            month: 1,
            name: 'Feriado local',
            ownerId,
            year: null,
          },
        ],
        location: { municipalityCode: '3509502', stateCode: 'SP' },
      }),
      clock,
    ).execute({
      actorId: ownerId,
      at: new Date('2026-12-10T12:00:00.000Z'),
      cardId: 'card-id',
    });

    expect(view.timeZone).toBe('America/Sao_Paulo');
    expect(view.cycle.scheduledDueOn.toString()).toBe('2027-01-07');
    expect(view.cycle.dueOn.toString()).toBe('2027-01-08');
  });

  it('hides cards of other holders', async () => {
    await expect(
      new GetCreditCardCycleUseCase(
        cards(card()),
        profiles(null),
        holidays(EMPTY_HOLIDAY_SETTINGS),
        clock,
      ).execute({ actorId: 'intruder', cardId: 'card-id' }),
    ).rejects.toThrow(CreditCardNotFoundError);
  });
});
