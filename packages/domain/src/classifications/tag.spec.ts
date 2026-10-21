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
      archivedAt: null,
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

  it('archives and restores without changing identity or name', () => {
    const tag = Tag.create({
      createdAt,
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
    });
    const archivedAt = new Date('2026-09-20T13:00:00.000Z');
    tag.setArchived(true, archivedAt);
    expect(tag.isArchived).toBe(true);
    expect(tag.toSnapshot()).toMatchObject({
      archivedAt,
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
      version: 2,
    });

    const restoredAt = new Date('2026-09-20T14:00:00.000Z');
    tag.setArchived(false, restoredAt);
    expect(tag.isArchived).toBe(false);
    expect(tag.toSnapshot()).toMatchObject({
      archivedAt: null,
      updatedAt: restoredAt,
      version: 3,
    });
  });

  it('rejects an archive instant before its last update', () => {
    const tag = Tag.create({
      createdAt,
      id: 'tag-id',
      name: 'Essencial',
      ownerId: 'owner-id',
    });
    tag.rename('Prioritário', new Date('2026-09-20T13:00:00.000Z'));
    expect(() => {
      tag.setArchived(true, new Date('2026-09-20T12:59:59.000Z'));
    }).toThrow(InvalidTagError);
  });
});
