import { Counterparty } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  ChangeOwnedCounterpartyStatusUseCase,
  CounterpartyConflictError,
  CounterpartyEliminationBlockedError,
  EliminateOwnedCounterpartyUseCase,
  GetOwnedCounterpartyUseCase,
  InvalidMergeTargetError,
  MergeOwnedCounterpartiesUseCase,
  OwnedCounterpartyNotFoundError,
  PreviewOwnedCounterpartyImpactUseCase,
  RestoreOwnedCounterpartyUseCase,
  AnonymizeDueCounterpartiesUseCase,
  type CounterpartyRepository,
} from './manage-counterparty.js';

const at = new Date('2026-10-05T12:00:00Z');
const ownerId = 'owner';
const otherId = 'other';
const source = Counterparty.create({
  id: 'source',
  ownerId,
  name: 'Source',
  type: 'person',
  email: null,
  phone: null,
  document: null,
  notes: null,
  createdAt: at,
});
const target = Counterparty.create({
  id: 'target',
  ownerId,
  name: 'Target',
  type: 'company',
  email: null,
  phone: null,
  document: null,
  notes: null,
  createdAt: at,
});

function repository(): CounterpartyRepository {
  const items = [
    Counterparty.restore(source.toSnapshot()),
    Counterparty.restore(target.toSnapshot()),
  ];
  return {
    insert: () => Promise.resolve(),
    findByIdForOwner: (id, owner) =>
      Promise.resolve(
        items.find((item) => item.id === id && item.ownerId === owner) ?? null,
      ),
    listForOwner: (owner) =>
      Promise.resolve(items.filter((item) => item.ownerId === owner)),
    save: () => Promise.resolve(true),
    merge: (_item, _version, targetId) =>
      Promise.resolve(targetId === target.id ? 'merged' : 'invalid-target'),
    impact: () =>
      Promise.resolve({
        transactionCount: 0,
        mergedSourceCount: 0,
        legalHold: false,
        canEliminate: true,
      }),
    eliminate: () => Promise.resolve('eliminated'),
    anonymizeDue: () => Promise.resolve(0),
  };
}

describe('owned counterparty use cases', () => {
  it('does not disclose another owner’s entity', async () => {
    await expect(
      new GetOwnedCounterpartyUseCase(repository()).execute(otherId, source.id),
    ).rejects.toBeInstanceOf(OwnedCounterpartyNotFoundError);
  });

  it('preserves owner scope for lifecycle operations', async () => {
    const useCase = new ChangeOwnedCounterpartyStatusUseCase(repository(), {
      now: () => new Date('2026-10-05T12:01:00Z'),
    });
    await expect(
      useCase.execute({
        actorId: otherId,
        id: source.id,
        action: 'deactivate',
      }),
    ).rejects.toBeInstanceOf(OwnedCounterpartyNotFoundError);
  });

  it('rejects an invalid merge target without persisting source', async () => {
    const useCase = new MergeOwnedCounterpartiesUseCase(repository(), {
      now: () => new Date('2026-10-05T12:01:00Z'),
    });
    await expect(
      useCase.execute({
        actorId: ownerId,
        sourceId: source.id,
        targetId: 'missing',
      }),
    ).rejects.toBeInstanceOf(InvalidMergeTargetError);
  });

  it('checks ownership before revealing elimination impact', async () => {
    const repo = repository();
    await expect(
      new PreviewOwnedCounterpartyImpactUseCase(repo).execute(
        otherId,
        source.id,
      ),
    ).rejects.toBeInstanceOf(OwnedCounterpartyNotFoundError);
    await expect(
      new PreviewOwnedCounterpartyImpactUseCase(repo).execute(
        ownerId,
        source.id,
      ),
    ).resolves.toMatchObject({ canEliminate: true, transactionCount: 0 });
  });

  it.each(['linked', 'held'] as const)(
    'refuses elimination when repository reports %s',
    async (outcome) => {
      const repo = {
        ...repository(),
        eliminate: () => Promise.resolve(outcome),
      };
      const useCase = new EliminateOwnedCounterpartyUseCase(repo, {
        now: () => new Date('2026-10-05T12:01:00Z'),
      });
      await expect(useCase.execute(ownerId, source.id)).rejects.toBeInstanceOf(
        CounterpartyEliminationBlockedError,
      );
    },
  );

  it('reports concurrent elimination and never returns a successful result', async () => {
    const repo = {
      ...repository(),
      eliminate: () => Promise.resolve('conflict' as const),
    };
    await expect(
      new EliminateOwnedCounterpartyUseCase(repo, {
        now: () => new Date('2026-10-05T12:01:00Z'),
      }).execute(ownerId, source.id),
    ).rejects.toBeInstanceOf(CounterpartyConflictError);
  });

  it('routes due anonymization through the injected clock', async () => {
    const due = new Date('2026-11-04T12:01:00Z');
    const calls: Date[] = [];
    const repo = {
      ...repository(),
      anonymizeDue: (at: Date) => {
        calls.push(at);
        return Promise.resolve(2);
      },
    };
    await expect(
      new AnonymizeDueCounterpartiesUseCase(repo, { now: () => due }).execute(),
    ).resolves.toBe(2);
    expect(calls).toEqual([due]);
  });

  it('restores an eliminated owned entity within 30 days and reports a stale save', async () => {
    const entity = Counterparty.create({
      id: 'restorable',
      ownerId,
      name: 'Restorable',
      type: 'person',
      email: null,
      phone: null,
      document: null,
      notes: null,
      createdAt: at,
    });
    entity.eliminate(new Date('2026-10-05T12:01:00Z'));
    const saved: number[] = [];
    const repo = {
      ...repository(),
      findByIdForOwner: () => Promise.resolve(entity),
      save: (_item: Counterparty, expectedVersion: number) => {
        saved.push(expectedVersion);
        return Promise.resolve(true);
      },
    };
    const useCase = new RestoreOwnedCounterpartyUseCase(repo, {
      now: () => new Date('2026-10-06T12:01:00Z'),
    });
    await expect(useCase.execute(ownerId, entity.id)).resolves.toMatchObject({
      id: entity.id,
    });
    expect(entity.toSnapshot().status).toBe('inactive');
    expect(saved).toEqual([2]);
  });
});
