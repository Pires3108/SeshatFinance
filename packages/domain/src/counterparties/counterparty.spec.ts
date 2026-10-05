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
});
