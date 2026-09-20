import { CostCenter } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  CostCenterVersionConflictError,
  CreateCostCenterUseCase,
  OwnedCostCenterNotFoundError,
  RenameOwnedCostCenterUseCase,
  type CostCenterRepository,
} from './manage-cost-center.js';

const now = new Date('2026-09-20T12:00:00.000Z');

function costCenter(): CostCenter {
  return CostCenter.create({
    createdAt: now,
    id: 'cost-center-id',
    name: 'Casa',
    ownerId: 'owner-id',
  });
}

function repository(value: CostCenter | null): CostCenterRepository {
  return {
    findByIdForOwner: (id, ownerId): Promise<CostCenter | null> =>
      Promise.resolve(
        value?.id === id && value.ownerId === ownerId ? value : null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForOwner: (): Promise<readonly CostCenter[]> =>
      Promise.resolve(value === null ? [] : [value]),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

describe('CreateCostCenterUseCase', () => {
  it('creates a cost center for the verified actor', async () => {
    const useCase = new CreateCostCenterUseCase(
      repository(null),
      { now: () => now },
      { generate: () => 'cost-center-id' },
    );

    const created = await useCase.execute({
      actorId: 'owner-id',
      name: 'Casa',
    });

    expect(created.toSnapshot()).toMatchObject({
      id: 'cost-center-id',
      name: 'Casa',
      ownerId: 'owner-id',
    });
  });
});

describe('RenameOwnedCostCenterUseCase', () => {
  it('renames using optimistic concurrency', async () => {
    const value = costCenter();
    let expectedVersion: number | undefined;
    const costCenters: CostCenterRepository = {
      ...repository(value),
      save: (_costCenter, version): Promise<boolean> => {
        expectedVersion = version;
        return Promise.resolve(true);
      },
    };
    const useCase = new RenameOwnedCostCenterUseCase(costCenters, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    const renamed = await useCase.execute({
      actorId: 'owner-id',
      costCenterId: value.id,
      name: 'Família',
    });

    expect(expectedVersion).toBe(1);
    expect(renamed.toSnapshot()).toMatchObject({
      name: 'Família',
      version: 2,
    });
  });

  it('does not reveal a cost center owned by another actor', async () => {
    const value = costCenter();
    const useCase = new RenameOwnedCostCenterUseCase(repository(value), {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(
      useCase.execute({
        actorId: 'other-owner-id',
        costCenterId: value.id,
        name: 'Família',
      }),
    ).rejects.toBeInstanceOf(OwnedCostCenterNotFoundError);
  });

  it('reports concurrent persistence changes', async () => {
    const value = costCenter();
    const costCenters: CostCenterRepository = {
      ...repository(value),
      save: (): Promise<boolean> => Promise.resolve(false),
    };
    const useCase = new RenameOwnedCostCenterUseCase(costCenters, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(
      useCase.execute({
        actorId: 'owner-id',
        costCenterId: value.id,
        name: 'Família',
      }),
    ).rejects.toBeInstanceOf(CostCenterVersionConflictError);
  });
});
