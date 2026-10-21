import { CostCenter } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface CostCenterRepository {
  insert(costCenter: CostCenter): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<CostCenter | null>;
  listForOwner(ownerId: string): Promise<readonly CostCenter[]>;
  save(costCenter: CostCenter, expectedVersion: number): Promise<boolean>;
  deleteUnlinked?(
    id: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<'deleted' | 'linked' | 'conflict'>;
}

export class DuplicateCostCenterError extends Error {
  public constructor() {
    super('Cost center name already exists.');
    this.name = 'DuplicateCostCenterError';
  }
}

export class CostCenterLinkedError extends Error {
  public constructor() {
    super('Cost center has transaction links.');
    this.name = 'CostCenterLinkedError';
  }
}

export type CreateCostCenterCommand = Readonly<{
  actorId: string;
  name: string;
}>;

export class OwnedCostCenterNotFoundError extends Error {
  public constructor() {
    super('Owned cost center was not found.');
    this.name = 'OwnedCostCenterNotFoundError';
  }
}

export class CostCenterVersionConflictError extends Error {
  public constructor() {
    super('Cost center was modified concurrently.');
    this.name = 'CostCenterVersionConflictError';
  }
}

export class CreateCostCenterUseCase {
  public constructor(
    private readonly costCenters: CostCenterRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateCostCenterCommand): Promise<CostCenter> {
    const costCenter = CostCenter.create({
      createdAt: this.clock.now(),
      id: this.identifiers.generate(),
      name: command.name,
      ownerId: command.actorId,
    });
    await this.costCenters.insert(costCenter);
    return costCenter;
  }
}

export class ListOwnedCostCentersUseCase {
  public constructor(private readonly costCenters: CostCenterRepository) {}

  public execute(actorId: string): Promise<readonly CostCenter[]> {
    return this.costCenters.listForOwner(actorId);
  }
}

export class GetOwnedCostCenterUseCase {
  public constructor(private readonly costCenters: CostCenterRepository) {}

  public async execute(command: {
    actorId: string;
    costCenterId: string;
  }): Promise<CostCenter> {
    const costCenter = await this.costCenters.findByIdForOwner(
      command.costCenterId,
      command.actorId,
    );
    if (costCenter === null) throw new OwnedCostCenterNotFoundError();
    return costCenter;
  }
}

export class SetOwnedCostCenterArchivedUseCase {
  public constructor(
    private readonly costCenters: CostCenterRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    actorId: string;
    costCenterId: string;
    archived: boolean;
  }): Promise<CostCenter> {
    const costCenter = await this.costCenters.findByIdForOwner(
      command.costCenterId,
      command.actorId,
    );
    if (costCenter === null) throw new OwnedCostCenterNotFoundError();
    if (costCenter.isArchived === command.archived) return costCenter;
    const version = costCenter.toSnapshot().version;
    costCenter.setArchived(command.archived, this.clock.now());
    if (!(await this.costCenters.save(costCenter, version)))
      throw new CostCenterVersionConflictError();
    return costCenter;
  }
}

export class DeleteOwnedCostCenterUseCase {
  public constructor(private readonly costCenters: CostCenterRepository) {}

  public async execute(command: {
    actorId: string;
    costCenterId: string;
  }): Promise<void> {
    const costCenter = await this.costCenters.findByIdForOwner(
      command.costCenterId,
      command.actorId,
    );
    if (costCenter === null) throw new OwnedCostCenterNotFoundError();
    if (this.costCenters.deleteUnlinked === undefined)
      throw new Error('Cost center deletion unavailable.');
    const result = await this.costCenters.deleteUnlinked(
      costCenter.id,
      command.actorId,
      costCenter.toSnapshot().version,
    );
    if (result === 'linked') throw new CostCenterLinkedError();
    if (result === 'conflict') throw new CostCenterVersionConflictError();
  }
}

export class RenameOwnedCostCenterUseCase {
  public constructor(
    private readonly costCenters: CostCenterRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    actorId: string;
    costCenterId: string;
    name: string;
  }): Promise<CostCenter> {
    const costCenter = await this.costCenters.findByIdForOwner(
      command.costCenterId,
      command.actorId,
    );
    if (costCenter === null) throw new OwnedCostCenterNotFoundError();
    const expectedVersion = costCenter.toSnapshot().version;
    costCenter.rename(command.name, this.clock.now());
    if (!(await this.costCenters.save(costCenter, expectedVersion))) {
      throw new CostCenterVersionConflictError();
    }
    return costCenter;
  }
}
