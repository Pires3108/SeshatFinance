import { Tag } from '@seshat/domain';
import { describe, expect, it } from 'vitest';

import {
  CreateTagUseCase,
  DeleteOwnedTagUseCase,
  GetOwnedTagUseCase,
  OwnedTagNotFoundError,
  RenameOwnedTagUseCase,
  SetOwnedTagArchivedUseCase,
  TagLinkedError,
  TagVersionConflictError,
  type TagRepository,
} from './manage-tag.js';

const now = new Date('2026-09-20T12:00:00.000Z');

function tag(): Tag {
  return Tag.create({
    createdAt: now,
    id: 'tag-id',
    name: 'Essencial',
    ownerId: 'owner-id',
  });
}

function repository(value: Tag | null): TagRepository {
  return {
    findByIdForOwner: (id, ownerId): Promise<Tag | null> =>
      Promise.resolve(
        value?.id === id && value.ownerId === ownerId ? value : null,
      ),
    insert: (): Promise<void> => Promise.resolve(),
    listForOwner: (): Promise<readonly Tag[]> =>
      Promise.resolve(value === null ? [] : [value]),
    save: (): Promise<boolean> => Promise.resolve(true),
  };
}

describe('CreateTagUseCase', () => {
  it('creates a tag for the verified actor', async () => {
    const useCase = new CreateTagUseCase(
      repository(null),
      { now: () => now },
      { generate: () => 'tag-id' },
    );

    const created = await useCase.execute({
      actorId: 'owner-id',
      name: 'Essencial',
    });

    expect(created.toSnapshot()).toMatchObject({
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
    });
  });
});

describe('Tag lifecycle use cases', () => {
  it('reads an archived tag for its owner while hiding it from another actor', async () => {
    const value = tag();
    value.setArchived(true, new Date('2026-09-20T13:00:00.000Z'));
    const useCase = new GetOwnedTagUseCase(repository(value));

    await expect(
      useCase.execute({ actorId: 'owner-id', tagId: value.id }),
    ).resolves.toBe(value);
    await expect(
      useCase.execute({ actorId: 'other-owner-id', tagId: value.id }),
    ).rejects.toBeInstanceOf(OwnedTagNotFoundError);
  });

  it('archives with optimistic concurrency and preserves identity', async () => {
    const value = tag();
    let expectedVersion: number | undefined;
    const tags: TagRepository = {
      ...repository(value),
      save: (_tag, version): Promise<boolean> => {
        expectedVersion = version;
        return Promise.resolve(true);
      },
    };
    const useCase = new SetOwnedTagArchivedUseCase(tags, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    const archived = await useCase.execute({
      actorId: 'owner-id',
      tagId: value.id,
      archived: true,
    });
    expect(expectedVersion).toBe(1);
    expect(archived.toSnapshot()).toMatchObject({
      id: value.id,
      ownerId: 'owner-id',
      archivedAt: new Date('2026-09-20T13:00:00.000Z'),
      version: 2,
    });
  });

  it('rejects a concurrent archive update', async () => {
    const value = tag();
    const tags: TagRepository = {
      ...repository(value),
      save: (): Promise<boolean> => Promise.resolve(false),
    };
    const useCase = new SetOwnedTagArchivedUseCase(tags, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });
    await expect(
      useCase.execute({ actorId: 'owner-id', tagId: value.id, archived: true }),
    ).rejects.toBeInstanceOf(TagVersionConflictError);
  });

  it.each(['linked', 'conflict'] as const)(
    'maps %s deletion result',
    async (result) => {
      const value = tag();
      const tags: TagRepository = {
        ...repository(value),
        deleteUnlinked: (): Promise<typeof result> => Promise.resolve(result),
      };
      const useCase = new DeleteOwnedTagUseCase(tags);
      await expect(
        useCase.execute({ actorId: 'owner-id', tagId: value.id }),
      ).rejects.toBeInstanceOf(
        result === 'linked' ? TagLinkedError : TagVersionConflictError,
      );
    },
  );
});

describe('RenameOwnedTagUseCase', () => {
  it('renames using optimistic concurrency', async () => {
    const value = tag();
    let expectedVersion: number | undefined;
    const tags: TagRepository = {
      ...repository(value),
      save: (_tag, version): Promise<boolean> => {
        expectedVersion = version;
        return Promise.resolve(true);
      },
    };
    const useCase = new RenameOwnedTagUseCase(tags, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    const renamed = await useCase.execute({
      actorId: 'owner-id',
      name: 'Prioritário',
      tagId: value.id,
    });

    expect(expectedVersion).toBe(1);
    expect(renamed.toSnapshot()).toMatchObject({
      name: 'Prioritário',
      version: 2,
    });
  });

  it('does not reveal a tag owned by another actor', async () => {
    const value = tag();
    const useCase = new RenameOwnedTagUseCase(repository(value), {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(
      useCase.execute({
        actorId: 'other-owner-id',
        name: 'Prioritário',
        tagId: value.id,
      }),
    ).rejects.toBeInstanceOf(OwnedTagNotFoundError);
  });

  it('reports concurrent persistence changes', async () => {
    const value = tag();
    const tags: TagRepository = {
      ...repository(value),
      save: (): Promise<boolean> => Promise.resolve(false),
    };
    const useCase = new RenameOwnedTagUseCase(tags, {
      now: () => new Date('2026-09-20T13:00:00.000Z'),
    });

    await expect(
      useCase.execute({
        actorId: 'owner-id',
        name: 'Prioritário',
        tagId: value.id,
      }),
    ).rejects.toBeInstanceOf(TagVersionConflictError);
  });
});
