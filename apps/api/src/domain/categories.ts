import {
  type AssetClass,
  CATEGORY_COLORS,
  type CategoryColor,
  type Currency,
} from "@portifolio-tracker/shared";

/** A ticker that can receive a category, before the assignment is applied. */
export type AssetRef = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  traded: boolean;
};

/**
 * Builds the unique ticker list the categories screen shows: traded names
 * win over watch-only rows, which win over assignment-only leftovers.
 */
export function mergeAssetUniverse(
  traded: readonly Omit<AssetRef, "traded">[],
  watched: readonly Omit<AssetRef, "traded">[],
  assignedTickers: readonly string[],
): AssetRef[] {
  const byTicker = new Map<string, AssetRef>();

  for (const ticker of assignedTickers) {
    if (!byTicker.has(ticker)) {
      byTicker.set(ticker, {
        ticker,
        assetClass: "other",
        currency: "USD",
        traded: false,
      });
    }
  }

  for (const row of watched) {
    byTicker.set(row.ticker, { ...row, traded: false });
  }

  for (const row of traded) {
    byTicker.set(row.ticker, { ...row, traded: true });
  }

  return [...byTicker.values()].sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  );
}

/** Next chart token in the cycle so new categories do not all look the same. */
export function nextCategoryColor(existingCount: number): CategoryColor {
  const length = CATEGORY_COLORS.length;
  const index = ((existingCount % length) + length) % length;

  return CATEGORY_COLORS[index] ?? "chart-1";
}

/** Case-insensitive name clash, ignoring the row being renamed. */
export function categoryNameTaken(
  name: string,
  existing: readonly { id: string; name: string }[],
  exceptId?: string,
): boolean {
  const needle = name.toLowerCase();

  return existing.some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === needle,
  );
}
