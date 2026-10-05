import { Counterparty } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  ChangeOwnedCounterpartyStatusUseCase,
  GetOwnedCounterpartyUseCase,
  InvalidMergeTargetError,
  MergeOwnedCounterpartiesUseCase,
  OwnedCounterpartyNotFoundError,
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
  const items = [source, target];
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
});
