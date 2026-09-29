import {
  ResolveAuthenticatedActorUseCase,
  type OpaqueSessionService,
} from '@seshat/application';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from './authenticated-actor-context.js';
import { BearerAuthGuard } from './bearer-auth.guard.js';

function executionContext(
  authorization?: string,
  cookie?: string,
): ExecutionContext {
  const request = { headers: { authorization, cookie } } as FastifyRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('BearerAuthGuard', () => {
  it('resolves the browser cookie without passing it to the provider verifier', async () => {
    const execute = vi.fn<ResolveAuthenticatedActorUseCase['execute']>();
    const resolve = vi
      .fn()
      .mockResolvedValue('00000000-0000-4000-8000-000000000001');
    const guard = new BearerAuthGuard(
      new ResolveAuthenticatedActorUseCase({ verify: execute }),
      new AuthenticatedActorContext(),
      { resolve } as unknown as OpaqueSessionService,
    );

    await expect(
      guard.canActivate(
        executionContext(undefined, `__Host-seshat_session=${'a'.repeat(43)}`),
      ),
    ).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('a'.repeat(43));
    expect(execute).not.toHaveBeenCalled();
  });
  it('stores only the actor resolved from a verified bearer token', async () => {
    const execute = vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' });
    const actors = new AuthenticatedActorContext();
    const context = executionContext('Bearer synthetic-access-token');
    const guard = new BearerAuthGuard(
      new ResolveAuthenticatedActorUseCase({ verify: execute }),
      actors,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith('synthetic-access-token');
  });

  it('rejects missing credentials without calling the verifier', async () => {
    const execute = vi.fn<ResolveAuthenticatedActorUseCase['execute']>();
    const guard = new BearerAuthGuard(
      new ResolveAuthenticatedActorUseCase({ verify: execute }),
      new AuthenticatedActorContext(),
    );

    await expect(guard.canActivate(executionContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('maps verification failures to unauthenticated', async () => {
    const guard = new BearerAuthGuard(
      new ResolveAuthenticatedActorUseCase({
        verify: vi.fn().mockRejectedValue(new Error('provider detail')),
      }),
      new AuthenticatedActorContext(),
    );

    await expect(
      guard.canActivate(executionContext('Bearer invalid-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
