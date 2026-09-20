import type {
  CreateCostCenterUseCase,
  ListOwnedCostCentersUseCase,
  RenameOwnedCostCenterUseCase,
} from '@seshat/application';
import { CostCenter } from '@seshat/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { CostCenterController } from './cost-center.controller.js';

function request(actors: AuthenticatedActorContext): FastifyRequest {
  const value = {} as FastifyRequest;
  actors.set(value, { id: 'actor-id' });
  return value;
}

function costCenter(): CostCenter {
  return CostCenter.create({
    createdAt: new Date('2026-09-20T12:00:00.000Z'),
    id: '7c2c7a54-73fe-49a3-b0ea-19034bf22baf',
    name: 'Casa',
    ownerId: 'actor-id',
  });
}

describe('CostCenterController', () => {
  it('creates cost centers for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue(costCenter());
    const controller = new CostCenterController(
      { execute } as unknown as CreateCostCenterUseCase,
      { execute: vi.fn() } as unknown as ListOwnedCostCentersUseCase,
      { execute: vi.fn() } as unknown as RenameOwnedCostCenterUseCase,
      actors,
    );

    await controller.create(request(actors), { name: 'Casa' });

    expect(execute).toHaveBeenCalledWith({
      actorId: 'actor-id',
      name: 'Casa',
    });
  });

  it('lists cost centers only for the verified actor', async () => {
    const actors = new AuthenticatedActorContext();
    const execute = vi.fn().mockResolvedValue([costCenter()]);
    const controller = new CostCenterController(
      { execute: vi.fn() } as unknown as CreateCostCenterUseCase,
      { execute } as unknown as ListOwnedCostCentersUseCase,
      { execute: vi.fn() } as unknown as RenameOwnedCostCenterUseCase,
      actors,
    );

    const result = await controller.list(request(actors));

    expect(execute).toHaveBeenCalledWith('actor-id');
    expect(result).toHaveLength(1);
  });
});
