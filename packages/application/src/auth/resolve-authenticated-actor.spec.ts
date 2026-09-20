import { describe, expect, it, vi } from 'vitest';

import {
  ResolveAuthenticatedActorUseCase,
  type IdentityTokenVerifier,
} from './resolve-authenticated-actor.js';

describe('ResolveAuthenticatedActorUseCase', () => {
  it('derives the actor only from a verified identity token', async () => {
    const verify = vi
      .fn<IdentityTokenVerifier['verify']>()
      .mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' });

    const actor = await new ResolveAuthenticatedActorUseCase({
      verify,
    }).execute('synthetic-access-token');

    expect(actor).toEqual({ id: '00000000-0000-4000-8000-000000000001' });
    expect(verify).toHaveBeenCalledWith('synthetic-access-token');
  });
});
