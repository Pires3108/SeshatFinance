import { Counterparty, type CounterpartyDetails } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface CounterpartyRepository {
  insert(counterparty: Counterparty): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Counterparty | null>;
  listForOwner(
    ownerId: string,
    status?: 'active' | 'inactive' | 'merged',
  ): Promise<readonly Counterparty[]>;
  save(counterparty: Counterparty, expectedVersion: number): Promise<boolean>;
  merge(
    source: Counterparty,
    expectedVersion: number,
    targetId: string,
  ): Promise<'merged' | 'invalid-target' | 'conflict'>;
}

export class OwnedCounterpartyNotFoundError extends Error {
  public constructor() {
    super('Owned counterparty was not found.');
    this.name = 'OwnedCounterpartyNotFoundError';
  }
}

export class CounterpartyConflictError extends Error {
  public constructor() {
    super('Counterparty changed concurrently.');
    this.name = 'CounterpartyConflictError';
  }
}

export class InvalidMergeTargetError extends Error {
  public constructor() {
    super('Merge target must be another active owned counterparty.');
    this.name = 'InvalidMergeTargetError';
  }
}

export class CreateCounterpartyUseCase {
  public constructor(
    private readonly repository: CounterpartyRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}
  public async execute(
    command: CounterpartyDetails & { actorId: string },
  ): Promise<Counterparty> {
    const item = Counterparty.create({
      ...command,
      id: this.identifiers.generate(),
      ownerId: command.actorId,
      createdAt: this.clock.now(),
    });
    await this.repository.insert(item);
    return item;
  }
}

export class ListOwnedCounterpartiesUseCase {
  public constructor(private readonly repository: CounterpartyRepository) {}
  public execute(
    actorId: string,
    status?: 'active' | 'inactive' | 'merged',
  ): Promise<readonly Counterparty[]> {
    return this.repository.listForOwner(actorId, status);
  }
}

export class GetOwnedCounterpartyUseCase {
  public constructor(private readonly repository: CounterpartyRepository) {}
  public async execute(actorId: string, id: string): Promise<Counterparty> {
    const item = await this.repository.findByIdForOwner(id, actorId);
    if (item === null) throw new OwnedCounterpartyNotFoundError();
    return item;
  }
}

export class UpdateOwnedCounterpartyUseCase {
  public constructor(
    private readonly repository: CounterpartyRepository,
    private readonly clock: Clock,
  ) {}
  public async execute(
    command: CounterpartyDetails & { actorId: string; id: string },
  ): Promise<Counterparty> {
    const item = await new GetOwnedCounterpartyUseCase(this.repository).execute(
      command.actorId,
      command.id,
    );
    const version = item.toSnapshot().version;
    item.update(command, this.clock.now());
    if (!(await this.repository.save(item, version)))
      throw new CounterpartyConflictError();
    return item;
  }
}

export class ChangeOwnedCounterpartyStatusUseCase {
  public constructor(
    private readonly repository: CounterpartyRepository,
    private readonly clock: Clock,
  ) {}
  public async execute(command: {
    actorId: string;
    id: string;
    action: 'deactivate' | 'reactivate';
  }): Promise<Counterparty> {
    const item = await new GetOwnedCounterpartyUseCase(this.repository).execute(
      command.actorId,
      command.id,
    );
    const version = item.toSnapshot().version;
    if (command.action === 'deactivate') item.deactivate(this.clock.now());
    else item.reactivate(this.clock.now());
    if (!(await this.repository.save(item, version)))
      throw new CounterpartyConflictError();
    return item;
  }
}

export class MergeOwnedCounterpartiesUseCase {
  public constructor(
    private readonly repository: CounterpartyRepository,
    private readonly clock: Clock,
  ) {}
  public async execute(command: {
    actorId: string;
    sourceId: string;
    targetId: string;
  }): Promise<Counterparty> {
    const item = await new GetOwnedCounterpartyUseCase(this.repository).execute(
      command.actorId,
      command.sourceId,
    );
    const version = item.toSnapshot().version;
    item.mergeInto(command.targetId, this.clock.now());
    const result = await this.repository.merge(item, version, command.targetId);
    if (result === 'invalid-target') throw new InvalidMergeTargetError();
    if (result === 'conflict') throw new CounterpartyConflictError();
    return item;
  }
}
