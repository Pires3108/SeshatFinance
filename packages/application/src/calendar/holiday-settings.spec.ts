import { CivilDate, InvalidHolidayLocationError } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  DeclareHolidayUseCase,
  EMPTY_HOLIDAY_SETTINGS,
  InvalidDeclaredHolidayError,
  resolveHolidayPredicate,
  UpdateHolidayLocationUseCase,
  type DeclaredHolidayRecord,
  type HolidaySettings,
  type HolidaySettingsRepository,
} from './holiday-settings.js';

const clock = { now: () => new Date('2026-11-13T12:00:00.000Z') };

function repository(): HolidaySettingsRepository & {
  state: HolidaySettings;
} {
  const store = {
    state: EMPTY_HOLIDAY_SETTINGS,
    addDeclared: (holiday: DeclaredHolidayRecord) => {
      store.state = {
        ...store.state,
        declared: [...store.state.declared, holiday],
      };
      return Promise.resolve();
    },
    findForOwner: () => Promise.resolve(store.state),
    removeDeclared: () => Promise.resolve(false),
    saveLocation: (_owner: string, location: HolidaySettings['location']) => {
      store.state = { ...store.state, location };
      return Promise.resolve();
    },
  };
  return store;
}

describe('holiday settings', () => {
  it('stores a valid location and resolves its holidays', async () => {
    const repo = repository();
    await new UpdateHolidayLocationUseCase(repo, clock).execute({
      actorId: 'owner',
      municipalityCode: '3550308',
      stateCode: 'SP',
    });

    const isHoliday = await resolveHolidayPredicate(repo, 'owner');
    expect(isHoliday(CivilDate.parse('2027-01-25'))).toBe(true);
  });

  it('rejects a municipality from another state', async () => {
    await expect(
      new UpdateHolidayLocationUseCase(repository(), clock).execute({
        actorId: 'owner',
        municipalityCode: '3550308',
        stateCode: 'RJ',
      }),
    ).rejects.toThrow(InvalidHolidayLocationError);
  });

  it('declares a recurring holiday including 29 February', async () => {
    const repo = repository();
    const holiday = await new DeclareHolidayUseCase(repo, clock, {
      generate: () => 'holiday-id',
    }).execute({
      actorId: 'owner',
      day: 29,
      month: 2,
      name: '  Festa local  ',
      year: null,
    });

    expect(holiday).toMatchObject({ name: 'Festa local', ownerId: 'owner' });
    const isHoliday = await resolveHolidayPredicate(repo, 'owner');
    expect(isHoliday(CivilDate.parse('2028-02-29'))).toBe(true);
  });

  it.each([
    [{ day: 31, month: 4, name: 'X', year: null }],
    [{ day: 29, month: 2, name: 'X', year: 2027 }],
    [{ day: 1, month: 1, name: '   ', year: null }],
  ])('rejects invalid declared holiday %j', async (input) => {
    await expect(
      new DeclareHolidayUseCase(repository(), clock, {
        generate: () => 'id',
      }).execute({ actorId: 'owner', ...input }),
    ).rejects.toThrow(InvalidDeclaredHolidayError);
  });
});
