import { describe, expect, it } from 'vitest';

import { Counterparty, InvalidCounterpartyError } from './counterparty.js';

const now = new Date('2026-10-05T12:00:00Z');
const later = new Date('2026-10-05T12:01:00Z');

function create(): Counterparty {
  return Counterparty.create({
    id: 'source',
    ownerId: 'owner',
    name: ' Alice ',
    type: 'person',
    email: ' Alice@Example.COM ',
    phone: ' +55 (11) 99999-9999 ',
    document: null,
    notes: null,
    createdAt: now,
  });
}

describe('Counterparty', () => {
  it('minimizes and normalizes optional personal fields', () => {
    const snapshot = create().toSnapshot();
    expect(snapshot.name).toBe('Alice');
    expect(snapshot.email).toBe('alice@example.com');
    expect(snapshot.phone).toBe('+5511999999999');
    expect(snapshot.status).toBe('active');
  });

  it('deactivates without changing identity and can reactivate', () => {
    const item = create();
    item.deactivate(later);
    expect(item.toSnapshot().status).toBe('inactive');
    item.reactivate(new Date('2026-10-05T12:02:00Z'));
    expect(item.toSnapshot().status).toBe('active');
    expect(item.toSnapshot().id).toBe('source');
  });

  it('preserves the merge origin and refuses self merge or modification', () => {
    const item = create();
    expect(() => {
      item.mergeInto('source', later);
    }).toThrow(InvalidCounterpartyError);
    item.mergeInto('target', later);
    expect(item.toSnapshot()).toMatchObject({
      status: 'merged',
      mergedIntoId: 'target',
    });
    expect(() => {
      item.reactivate(later);
    }).toThrow(InvalidCounterpartyError);
  });

  it('rejects invalid lifecycle transitions and preserves the version', () => {
    const item = create();
    expect(() => {
      item.reactivate(later);
    }).toThrow(InvalidCounterpartyError);
    expect(item.toSnapshot().version).toBe(1);
    item.deactivate(later);
    expect(() => {
      item.deactivate(new Date('2026-10-05T12:02:00Z'));
    }).toThrow(InvalidCounterpartyError);
    expect(item.toSnapshot().version).toBe(2);
  });

  it('rejects a stale update and invalid restored merge state', () => {
    const item = create();
    expect(() => {
      item.deactivate(new Date('2026-10-05T11:59:59Z'));
    }).toThrow(InvalidCounterpartyError);
    expect(() =>
      Counterparty.restore({
        ...item.toSnapshot(),
        status: 'merged',
        mergedIntoId: null,
      }),
    ).toThrow(InvalidCounterpartyError);
  });

  it('does not allow updating a merged source or changing its historical target', () => {
    const item = create();
    item.mergeInto('target', later);
    const merged = item.toSnapshot();
    expect(() => {
      item.update(
        {
          name: 'Changed',
          type: 'person',
          email: null,
          phone: null,
          document: null,
          notes: null,
        },
        new Date('2026-10-05T12:02:00Z'),
      );
    }).toThrow(InvalidCounterpartyError);
    expect(() => {
      item.mergeInto('another', new Date('2026-10-05T12:02:00Z'));
    }).toThrow(InvalidCounterpartyError);
    expect(item.toSnapshot()).toEqual(merged);
  });

  it('keeps an eliminated entity restorable until day 30 and restores it inactive', () => {
    const item = create();
    item.eliminate(later);
    expect(item.toSnapshot()).toMatchObject({
      status: 'eliminated',
      eliminatedAt: later,
      anonymizedAt: null,
    });
    expect(() => {
      item.update(
        {
          name: 'Changed',
          type: 'person',
          email: null,
          phone: null,
          document: null,
          notes: null,
        },
        later,
      );
    }).toThrow(InvalidCounterpartyError);
    item.restoreEliminated(
      new Date(later.getTime() + 30 * 24 * 60 * 60 * 1000 - 1),
    );
    expect(item.toSnapshot()).toMatchObject({
      status: 'inactive',
      eliminatedAt: null,
      name: 'Alice',
    });
  });

  it('rejects restoration after day 30 without changing the eliminated entity', () => {
    const item = create();
    item.eliminate(later);
    const before = item.toSnapshot();
    expect(() => {
      item.restoreEliminated(
        new Date(later.getTime() + 30 * 24 * 60 * 60 * 1000),
      );
    }).toThrow(InvalidCounterpartyError);
    expect(item.toSnapshot()).toEqual(before);
  });

  it('requires a valid elimination instant when restoring persisted state', () => {
    const item = create();
    expect(() =>
      Counterparty.restore({
        ...item.toSnapshot(),
        status: 'eliminated',
        eliminatedAt: null,
      }),
    ).toThrow(InvalidCounterpartyError);
  });
});
