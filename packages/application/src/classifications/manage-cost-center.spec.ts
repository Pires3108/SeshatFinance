import { CostCenter } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  CostCenterVersionConflictError,
  CostCenterLinkedError,
  CreateCostCenterUseCase,
  DeleteOwnedCostCenterUseCase,
  GetOwnedCostCenterUseCase,
  OwnedCostCenterNotFoundError,
  RenameOwnedCostCenterUseCase,
  SetOwnedCostCenterArchivedUseCase,
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

describe('Cost center lifecycle use cases', () => {
  it('reads an archived center for its owner and hides it from another actor', async () => {
    const value = costCenter();
    value.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    const useCase = new GetOwnedCostCenterUseCase(repository(value));

    await expect(
      useCase.execute({ actorId: 'owner-id', costCenterId: value.id }),
    ).resolves.toBe(value);
    await expect(
      useCase.execute({ actorId: 'other-owner-id', costCenterId: value.id }),
    ).rejects.toBeInstanceOf(OwnedCostCenterNotFoundError);
  });

  it('archives with optimistic concurrency', async () => {
    const value = costCenter();
    let expectedVersion: number | undefined;
    const centers: CostCenterRepository = {
      ...repository(value),
      save: (_center, version): Promise<boolean> => {
        expectedVersion = version;
        return Promise.resolve(true);
      },
    };
    const useCase = new SetOwnedCostCenterArchivedUseCase(centers, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    const archived = await useCase.execute({
      actorId: 'owner-id',
      costCenterId: value.id,
      archived: true,
    });
    expect(expectedVersion).toBe(1);
    expect(archived.toSnapshot()).toMatchObject({
      archivedAt: new Date('2026-09-20T13:00:00.000Z'),
      version: 2,
    });
  });

  it('reports concurrent archive updates', async () => {
    const value = costCenter();
    const centers: CostCenterRepository = {
      ...repository(value),
      save: (): Promise<boolean> => Promise.resolve(false),
    };
    const useCase = new SetOwnedCostCenterArchivedUseCase(centers, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });
    await expect(
      useCase.execute({
        actorId: 'owner-id',
        costCenterId: value.id,
        archived: true,
      }),
    ).rejects.toBeInstanceOf(CostCenterVersionConflictError);
  });

  it.each(['linked', 'conflict'] as const)(
    'maps %s deletion result',
    async (result) => {
      const value = costCenter();
      const centers: CostCenterRepository = {
        ...repository(value),
        deleteUnlinked: (): Promise<typeof result> => Promise.resolve(result),
      };
      const useCase = new DeleteOwnedCostCenterUseCase(centers);
      await expect(
        useCase.execute({ actorId: 'owner-id', costCenterId: value.id }),
      ).rejects.toBeInstanceOf(
        result === 'linked'
          ? CostCenterLinkedError
          : CostCenterVersionConflictError,
      );
    },
  );
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
