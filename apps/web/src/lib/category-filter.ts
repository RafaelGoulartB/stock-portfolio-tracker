/** Shared values and matching rule for account-owned category filters. */
export const CATEGORY_ALL = "all";
export const CATEGORY_NONE = "none";

export function matchesCategory(
  selectedCategory: string,
  categoryId: string | null,
): boolean {
  if (selectedCategory === CATEGORY_ALL) {
    return true;
  }

  if (selectedCategory === CATEGORY_NONE) {
    return categoryId === null;
  }

  return categoryId === selectedCategory;
}
