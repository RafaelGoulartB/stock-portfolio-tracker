import { describe, expect, it } from "vitest";
import {
  CATEGORY_ALL,
  CATEGORY_NONE,
  matchesCategory,
} from "./category-filter";

describe("matchesCategory", () => {
  it("matches every asset when all categories are selected", () => {
    expect(matchesCategory(CATEGORY_ALL, "category-1")).toBe(true);
    expect(matchesCategory(CATEGORY_ALL, null)).toBe(true);
  });

  it("matches only uncategorized assets for the none option", () => {
    expect(matchesCategory(CATEGORY_NONE, null)).toBe(true);
    expect(matchesCategory(CATEGORY_NONE, "category-1")).toBe(false);
  });

  it("matches only the selected category id", () => {
    expect(matchesCategory("category-1", "category-1")).toBe(true);
    expect(matchesCategory("category-1", "category-2")).toBe(false);
    expect(matchesCategory("category-1", null)).toBe(false);
  });
});
