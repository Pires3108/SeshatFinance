import {
  ChangeOwnedCounterpartyStatusUseCase,
  CounterpartyEliminationBlockedError,
  EliminateOwnedCounterpartyUseCase,
  GetOwnedCounterpartyUseCase,
  InvalidMergeTargetError,
  ListOwnedCounterpartiesUseCase,
  MergeOwnedCounterpartiesUseCase,
  OwnedCounterpartyNotFoundError,
  PreviewOwnedCounterpartyImpactUseCase,
  ResolveAuthenticatedActorUseCase,
  RestoreOwnedCounterpartyUseCase,
} from '@seshat/application';
import { Counterparty } from '@seshat/domain';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/platform/configure-application.js';

const actorId = 'actor-b';
const counterpartyId = 'a29cdcc8-2615-412b-84a6-14b47c6701d9';
const targetId = '8502021f-f0af-4a48-8827-6145195d19a9';

function counterparty(): Counterparty {
  return Counterparty.create({
    id: counterpartyId,
    ownerId: actorId,
    name: 'Exemplo',
    type: 'person',
    email: null,
    phone: null,
    document: null,
    notes: null,
    createdAt: new Date('2026-10-05T12:00:00Z'),
  });
}

describe('Counterparty HTTP authorization', () => {
  let application: NestFastifyApplication;
  const resolveActor = {
    execute: vi
      .fn<ResolveAuthenticatedActorUseCase['execute']>()
      .mockResolvedValue({ id: actorId }),
  };
  const getCounterparty = {
    execute: vi.fn<GetOwnedCounterpartyUseCase['execute']>(),
  };
  const listCounterparties = {
    execute: vi.fn<ListOwnedCounterpartiesUseCase['execute']>(),
  };
  const changeStatus = {
    execute: vi.fn<ChangeOwnedCounterpartyStatusUseCase['execute']>(),
  };
  const merge = {
    execute: vi.fn<MergeOwnedCounterpartiesUseCase['execute']>(),
  };
  const impact = {
    execute: vi.fn<PreviewOwnedCounterpartyImpactUseCase['execute']>(),
  };
  const eliminate = {
    execute: vi.fn<EliminateOwnedCounterpartyUseCase['execute']>(),
  };
  const restore = {
    execute: vi.fn<RestoreOwnedCounterpartyUseCase['execute']>(),
  };

  beforeEach(async (): Promise<void> => {
    resolveActor.execute.mockClear();
    getCounterparty.execute.mockReset().mockResolvedValue(counterparty());
    listCounterparties.execute.mockReset().mockResolvedValue([counterparty()]);
    changeStatus.execute.mockReset().mockResolvedValue(counterparty());
    merge.execute.mockReset().mockResolvedValue(counterparty());
    impact.execute.mockReset().mockResolvedValue({
      transactionCount: 0,
      mergedSourceCount: 0,
      legalHold: false,
      canEliminate: true,
    });
    eliminate.execute.mockReset().mockResolvedValue(counterparty());
    restore.execute.mockReset().mockResolvedValue(counterparty());
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ResolveAuthenticatedActorUseCase)
      .useValue(resolveActor)
      .overrideProvider(GetOwnedCounterpartyUseCase)
      .useValue(getCounterparty)
      .overrideProvider(ListOwnedCounterpartiesUseCase)
      .useValue(listCounterparties)
      .overrideProvider(ChangeOwnedCounterpartyStatusUseCase)
      .useValue(changeStatus)
      .overrideProvider(MergeOwnedCounterpartiesUseCase)
      .useValue(merge)
      .overrideProvider(PreviewOwnedCounterpartyImpactUseCase)
      .useValue(impact)
      .overrideProvider(EliminateOwnedCounterpartyUseCase)
      .useValue(eliminate)
      .overrideProvider(RestoreOwnedCounterpartyUseCase)
      .useValue(restore)
      .compile();
    application = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    configureApplication(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
  });

  afterEach(async (): Promise<void> => {
    await application.close();
  });

  it('passes the authenticated actor to status-filtered listing', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: '/api/v1/counterparties?status=active',
    });
    expect(response.statusCode).toBe(200);
    expect(listCounterparties.execute).toHaveBeenCalledWith(actorId, 'active');
  });

  it('hides another owner entity on GET and status changes', async () => {
    getCounterparty.execute.mockRejectedValueOnce(
      new OwnedCounterpartyNotFoundError(),
    );
    changeStatus.execute.mockRejectedValueOnce(
      new OwnedCounterpartyNotFoundError(),
    );
    const get = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/counterparties/${counterpartyId}`,
    });
    const deactivate = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'POST',
      url: `/api/v1/counterparties/${counterpartyId}/deactivate`,
    });
    expect(get.statusCode).toBe(404);
    expect(deactivate.statusCode).toBe(404);
    expect(changeStatus.execute).toHaveBeenCalledWith({
      actorId,
      id: counterpartyId,
      action: 'deactivate',
    });
  });

  it('rejects a foreign or inactive merge target', async () => {
    merge.execute.mockRejectedValueOnce(new InvalidMergeTargetError());
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'POST',
      payload: { targetId },
      url: `/api/v1/counterparties/${counterpartyId}/merge`,
    });
    expect(response.statusCode).toBe(400);
    expect(merge.execute).toHaveBeenCalledWith({
      actorId,
      sourceId: counterpartyId,
      targetId,
    });
  });

  it('scopes impact preview and elimination to the authenticated owner', async () => {
    const preview = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/counterparties/${counterpartyId}/impact`,
    });
    expect(preview.statusCode).toBe(200);
    expect(impact.execute).toHaveBeenCalledWith(actorId, counterpartyId);
    const deletion = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'POST',
      url: `/api/v1/counterparties/${counterpartyId}/eliminate`,
    });
    expect(deletion.statusCode).toBe(201);
    expect(eliminate.execute).toHaveBeenCalledWith(actorId, counterpartyId);
  });

  it('does not reveal foreign impact and maps a financial impediment to conflict', async () => {
    impact.execute.mockRejectedValueOnce(new OwnedCounterpartyNotFoundError());
    eliminate.execute.mockRejectedValueOnce(
      new CounterpartyEliminationBlockedError(),
    );
    const preview = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'GET',
      url: `/api/v1/counterparties/${counterpartyId}/impact`,
    });
    const deletion = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'POST',
      url: `/api/v1/counterparties/${counterpartyId}/eliminate`,
    });
    expect(preview.statusCode).toBe(404);
    expect(deletion.statusCode).toBe(409);
  });

  it('scopes restoration to the authenticated owner', async () => {
    const response = await application.inject({
      headers: { authorization: 'Bearer actor-b-token' },
      method: 'POST',
      url: `/api/v1/counterparties/${counterpartyId}/restore`,
    });
    expect(response.statusCode).toBe(201);
    expect(restore.execute).toHaveBeenCalledWith(actorId, counterpartyId);
  });
});
