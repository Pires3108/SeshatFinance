import { describe, expect, it } from 'vitest';

import { InvalidTagError, Tag } from './tag.js';

const createdAt = new Date('2026-09-20T12:00:00.000Z');

describe('Tag', () => {
  it('creates an owned tag with a normalized name', () => {
    const tag = Tag.create({
      createdAt,
      id: 'tag-id',
      name: ' Essencial ',
      ownerId: 'owner-id',
    });

    expect(tag.toSnapshot()).toEqual({
      createdAt,
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
      updatedAt: createdAt,
      version: 1,
    });
  });

  it('renames without changing ownership', () => {
    const tag = Tag.create({
      createdAt,
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
    });
    const updatedAt = new Date('2026-09-20T13:00:00.000Z');

    tag.rename(' Prioritário ', updatedAt);

    expect(tag.toSnapshot()).toMatchObject({
      name: 'Prioritário',
      ownerId: 'owner-id',
      updatedAt,
      version: 2,
    });
  });

  it('rejects blank names', () => {
    expect(() =>
      Tag.create({
        createdAt,
        id: 'tag-id',
        name: ' ',
        ownerId: 'owner-id',
      }),
    ).toThrow(InvalidTagError);
  });

  it('rejects an update before the previous state', () => {
    const tag = Tag.create({
      createdAt,
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
    });

    expect(() => {
      tag.rename('Prioritário', new Date('2026-09-20T11:59:59.000Z'));
    }).toThrow(InvalidTagError);
  });
});
