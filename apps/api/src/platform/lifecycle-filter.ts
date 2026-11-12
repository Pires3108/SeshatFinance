/**
 * Ordinary listings omit items in the trash (US-034). The trash stays
 * reachable through an explicit lifecycle=trashed filter, and an explicit
 * lifecycle filter is returned unchanged.
 */
export function withoutTrashUnlessRequested<
  T extends { readonly lifecycle: string },
>(items: readonly T[], requested: string | undefined): readonly T[] {
  if (requested !== undefined) return items;
  return items.filter((item) => item.lifecycle !== 'trashed');
}
