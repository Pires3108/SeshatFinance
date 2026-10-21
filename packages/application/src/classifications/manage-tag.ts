import { Tag } from '@seshat/domain';

import type { Clock } from '../ports/clock.js';
import type { IdentifierGenerator } from '../ports/identifier-generator.js';

export interface TagRepository {
  insert(tag: Tag): Promise<void>;
  findByIdForOwner(id: string, ownerId: string): Promise<Tag | null>;
  listForOwner(ownerId: string): Promise<readonly Tag[]>;
  save(tag: Tag, expectedVersion: number): Promise<boolean>;
  deleteUnlinked?(
    id: string,
    ownerId: string,
    expectedVersion: number,
  ): Promise<'deleted' | 'linked' | 'conflict'>;
}

export class DuplicateTagError extends Error {
  public constructor() {
    super('Tag name already exists.');
    this.name = 'DuplicateTagError';
  }
}

export class TagLinkedError extends Error {
  public constructor() {
    super('Tag has transaction links.');
    this.name = 'TagLinkedError';
  }
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

export class GetOwnedTagUseCase {
  public constructor(private readonly tags: TagRepository) {}

  public async execute(command: {
    actorId: string;
    tagId: string;
  }): Promise<Tag> {
    const tag = await this.tags.findByIdForOwner(
      command.tagId,
      command.actorId,
    );
    if (tag === null) throw new OwnedTagNotFoundError();
    return tag;
  }
}

export class SetOwnedTagArchivedUseCase {
  public constructor(
    private readonly tags: TagRepository,
    private readonly clock: Clock,
  ) {}

  public async execute(command: {
    actorId: string;
    tagId: string;
    archived: boolean;
  }): Promise<Tag> {
    const tag = await this.tags.findByIdForOwner(
      command.tagId,
      command.actorId,
    );
    if (tag === null) throw new OwnedTagNotFoundError();
    if (tag.isArchived === command.archived) return tag;
    const version = tag.toSnapshot().version;
    tag.setArchived(command.archived, this.clock.now());
    if (!(await this.tags.save(tag, version)))
      throw new TagVersionConflictError();
    return tag;
  }
}

export class DeleteOwnedTagUseCase {
  public constructor(private readonly tags: TagRepository) {}

  public async execute(command: {
    actorId: string;
    tagId: string;
  }): Promise<void> {
    const tag = await this.tags.findByIdForOwner(
      command.tagId,
      command.actorId,
    );
    if (tag === null) throw new OwnedTagNotFoundError();
    if (this.tags.deleteUnlinked === undefined)
      throw new Error('Tag deletion unavailable.');
    const result = await this.tags.deleteUnlinked(
      tag.id,
      command.actorId,
      tag.toSnapshot().version,
    );
    if (result === 'linked') throw new TagLinkedError();
    if (result === 'conflict') throw new TagVersionConflictError();
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
