import { describe, expect, it } from 'vitest';

import { Category, InvalidCategoryError } from './category.js';

const createdAt = new Date('2026-09-20T12:00:00.000Z');

describe('Category', () => {
  it('creates an owned root category with a normalized name', () => {
    const category = Category.create({
      createdAt,
      id: 'category-id',
      name: ' Alimentação ',
      ownerId: 'owner-id',
      parentCategoryId: null,
    });

    expect(category.toSnapshot()).toEqual({
      createdAt,
      id: 'category-id',
      name: 'Alimentação',
      ownerId: 'owner-id',
      parentCategoryId: null,
      updatedAt: createdAt,
      version: 1,
    });
  });

  it('creates a subcategory that references another category', () => {
    const category = Category.create({
      createdAt,
      id: 'subcategory-id',
      name: 'Mercado',
      ownerId: 'owner-id',
      parentCategoryId: ' category-id ',
    });

    expect(category.parentCategoryId).toBe('category-id');
  });

  it('rejects a category as its own parent', () => {
    expect(() =>
      Category.create({
        createdAt,
        id: 'category-id',
        name: 'Alimentação',
        ownerId: 'owner-id',
        parentCategoryId: 'category-id',
      }),
    ).toThrow(InvalidCategoryError);
  });

  it('renames while preserving ownership and hierarchy', () => {
    const category = Category.create({
      createdAt,
      id: 'subcategory-id',
      name: 'Mercado',
      ownerId: 'owner-id',
      parentCategoryId: 'category-id',
    });
    const updatedAt = new Date('2026-09-20T13:00:00.000Z');

    category.rename(' Supermercado ', updatedAt);

    expect(category.toSnapshot()).toMatchObject({
      name: 'Supermercado',
      ownerId: 'owner-id',
      parentCategoryId: 'category-id',
      updatedAt,
      version: 2,
    });
  });

  it('rejects an update before the previous state', () => {
    const category = Category.create({
      createdAt,
      id: 'category-id',
      name: 'Alimentação',
      ownerId: 'owner-id',
      parentCategoryId: null,
    });

    expect(() => {
      category.rename('Comida', new Date('2026-09-20T11:59:59.000Z'));
    }).toThrow(InvalidCategoryError);
  });
});
