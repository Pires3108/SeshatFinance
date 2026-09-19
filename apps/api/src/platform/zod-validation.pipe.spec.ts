import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ displayName: z.string().trim().min(1).max(120) }),
  );

  it('returns parsed input', (): void => {
    expect(pipe.transform({ displayName: '  Nicolas  ' })).toEqual({
      displayName: 'Nicolas',
    });
  });

  it('rejects invalid input without exposing validation internals', (): void => {
    expect(() => pipe.transform({ displayName: '' })).toThrow(
      BadRequestException,
    );
  });
});
