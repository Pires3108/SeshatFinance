import { describe, expect, it } from 'vitest';

import { CostCenter, InvalidCostCenterError } from './cost-center.js';

const createdAt = new Date('2026-09-20T12:00:00.000Z');

describe('CostCenter', () => {
  it('creates an owned cost center with a normalized name', () => {
    const costCenter = CostCenter.create({
      createdAt,
      id: 'cost-center-id',
      name: ' Casa ',
      ownerId: 'owner-id',
    });

    expect(costCenter.toSnapshot()).toEqual({
      createdAt,
      id: 'cost-center-id',
      name: 'Casa',
      ownerId: 'owner-id',
      updatedAt: createdAt,
      version: 1,
    });
  });

  it('rejects missing ownership', () => {
    expect(() =>
      CostCenter.create({
        createdAt,
        id: 'cost-center-id',
        name: 'Casa',
        ownerId: ' ',
      }),
    ).toThrow(InvalidCostCenterError);
  });

  it('renames while preserving ownership', () => {
    const costCenter = CostCenter.create({
      createdAt,
      id: 'cost-center-id',
      name: 'Casa',
      ownerId: 'owner-id',
    });
    const updatedAt = new Date('2026-09-20T13:00:00.000Z');

    costCenter.rename(' Família ', updatedAt);

    expect(costCenter.toSnapshot()).toMatchObject({
      name: 'Família',
      ownerId: 'owner-id',
      updatedAt,
      version: 2,
    });
  });

  it('rejects an update before the previous state', () => {
    const costCenter = CostCenter.create({
      createdAt,
      id: 'cost-center-id',
      name: 'Casa',
      ownerId: 'owner-id',
    });

    expect(() => {
      costCenter.rename('Família', new Date('2026-09-20T11:59:59.000Z'));
    }).toThrow(InvalidCostCenterError);
  });

  it('rejects an invalid restored version', () => {
    expect(() =>
      CostCenter.restore({
        createdAt,
        id: 'cost-center-id',
        name: 'Casa',
        ownerId: 'owner-id',
        updatedAt: createdAt,
        version: 0,
      }),
    ).toThrow(InvalidCostCenterError);
  });
});
