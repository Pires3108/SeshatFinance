import { describe, expect, it } from 'vitest';

import { withoutTrashUnlessRequested } from './lifecycle-filter.js';

const items = [
  { id: 'active', lifecycle: 'active' },
  { id: 'archived', lifecycle: 'archived' },
  { id: 'trashed', lifecycle: 'trashed' },
] as const;

describe('withoutTrashUnlessRequested (US-034)', () => {
  it('omits the trash from ordinary listings', () => {
    expect(
      withoutTrashUnlessRequested(items, undefined).map(({ id }) => id),
    ).toEqual(['active', 'archived']);
  });

  it.each(['active', 'archived', 'trashed'])(
    'keeps an explicit %s filter unchanged',
    (lifecycle) => {
      const filtered = items.filter((item) => item.lifecycle === lifecycle);
      expect(withoutTrashUnlessRequested(filtered, lifecycle)).toEqual(
        filtered,
      );
    },
  );
});
