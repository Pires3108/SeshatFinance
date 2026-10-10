import { describe, expect, it } from 'vitest';

import {
  completionResult,
  RECOVERY_UNAVAILABLE,
} from './recovery-completion-result';

describe('password recovery completion result', () => {
  it('treats a server error as a potentially consumed link and offers a fresh one', () => {
    expect(completionResult(503)).toBe('unavailable');
    expect(RECOVERY_UNAVAILABLE.message).toContain(
      'O link pode ter sido usado.',
    );
    expect(RECOVERY_UNAVAILABLE.actionHref).toBe('/recuperar-senha');
  });

  it('recognizes success and invalid or replayed links', () => {
    expect(completionResult(204)).toBe('success');
    expect(completionResult(400)).toBe('invalid');
  });
});
