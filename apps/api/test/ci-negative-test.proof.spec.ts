import { expect, it } from 'vitest';

it('rejects a broken assertion in the workspace test command', () => {
  expect(1).toBe(2);
});
