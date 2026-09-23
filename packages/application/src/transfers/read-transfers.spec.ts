import { describe, expect, it, vi } from 'vitest';

import {
  GetOwnedTransferUseCase,
  ListOwnedTransfersUseCase,
} from './read-transfers.js';

describe('owned transfer reads', () => {
  it('passes the actor identity to detail and filtered list queries', async () => {
    const findByIdForOwner = vi.fn().mockResolvedValue(null);
    const listForOwner = vi.fn().mockResolvedValue([]);
    const repository = { findByIdForOwner, listForOwner };

    await expect(
      new GetOwnedTransferUseCase(repository).execute(
        'transfer-id',
        'actor-id',
      ),
    ).resolves.toBeNull();
    await expect(
      new ListOwnedTransfersUseCase(repository).execute('actor-id', 'trashed'),
    ).resolves.toEqual([]);

    expect(findByIdForOwner).toHaveBeenCalledWith('transfer-id', 'actor-id');
    expect(listForOwner).toHaveBeenCalledWith('actor-id', 'trashed');
  });
});
