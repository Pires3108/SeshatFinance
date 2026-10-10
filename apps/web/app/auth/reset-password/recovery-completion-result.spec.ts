import { describe, expect, it } from 'vitest';

import {
  completionResult,
  RECOVERY_PASSWORD_REJECTED,
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

  it('offers a new link and stronger-password guidance after provider rejection', () => {
    expect(completionResult(422)).toBe('password-rejected');
    expect(RECOVERY_PASSWORD_REJECTED.message).toContain('12 caracteres');
    expect(RECOVERY_PASSWORD_REJECTED.actionHref).toBe('/recuperar-senha');
  });

  it('keeps a locally rejected short password distinct from a consumed token', () => {
    expect(completionResult(422, 'password_invalid')).toBe('password-invalid');
    expect(completionResult(400, 'invalid_input')).toBe('invalid');
  });
});
