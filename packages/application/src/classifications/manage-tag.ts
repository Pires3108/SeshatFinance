import { Tag } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface TagRepository {
  insert(tag: Tag): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Tag | null>;
  listForOwner(ownerId: string): Promise<readonly Tag[]>;
  save(tag: Tag, expectedVersion: number): Promise<boolean>;
}

export type CreateTagCommand = Readonly<{
  actorId: string;
  name: string;
}>;

export class OwnedTagNotFoundError extends Error {
  public constructor() {
    super('Owned tag was not found.');
    this.name = 'OwnedTagNotFoundError';
  }
}

export class TagVersionConflictError extends Error {
  public constructor() {
    super('Tag was modified concurrently.');
    this.name = 'TagVersionConflictError';
  }
}

export class CreateTagUseCase {
  public constructor(
    private readonly tags: TagRepository,
    private readonly clock: Clock,
    private readonly identifiers: IdentifierGenerator,
  ) {}

  public async execute(command: CreateTagCommand): Promise<Tag> {
    const tag = Tag.create({
      createdAt: this.clock.now(),
      id: this.identifiers.generate(),
      name: command.name,
      ownerId: command.actorId,
    });
    await this.tags.insert(tag);
    return tag;
  }
}

export class ListOwnedTagsUseCase {
  public constructor(private readonly tags: TagRepository) {}

  public execute(actorId: string): Promise<readonly Tag[]> {
    return this.tags.listForOwner(actorId);
  }
}

export class RenameOwnedTagUseCase {
  public constructor(
    private readonly tags: TagRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    actorId: string;
    name: string;
    tagId: string;
  }): Promise<Tag> {
    const tag = await this.tags.findByIdForOwner(
      command.tagId,
      command.actorId,
    );
    if (tag === null) throw new OwnedTagNotFoundError();
    const expectedVersion = tag.toSnapshot().version;
    tag.rename(command.name, this.clock.now());
    if (!(await this.tags.save(tag, expectedVersion))) {
      throw new TagVersionConflictError();
    }
    return tag;
  }
}
