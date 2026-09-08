import type { AllocationRow, NextResult } from "@portifolio-tracker/shared";
import type { AllocationColumn, AllocationSort } from "./columns";

export function sortableValue(
  row: AllocationRow,
  id: AllocationColumn,
  nextResults: ReadonlyMap<string, NextResult> = new Map(),
): string | number | null {
  switch (id) {
    case "ticker":
      return row.ticker;
    case "targetWeight":
      return row.targetWeight === null ? null : Number(row.targetWeight);
    case "currentWeight":
      return Number(row.currentWeight);
    case "gapWeight":
      return row.gapWeight === null ? null : Number(row.gapWeight);
    case "score":
      return Number(row.score.value);
    case "nextResult":
      return nextResults.get(row.ticker.toUpperCase())?.date ?? null;
    case "averageGrade":
      return row.averageGrade === null ? null : Number(row.averageGrade);
    case "discount":
      return row.discount === null ? null : Number(row.discount);
    case "lastContributionAt":
      return row.lastContributionAt;
    case "quantity":
      return Number(row.quantity);
    case "marketValue":
      return row.marketValue === null ? null : Number(row.marketValue);
  }
}

/**
 * The default score view should focus capital allocation on owned assets with
 * a target. Watch-only tickers can still be scored and sorted, but trail those
 * actionable positions until the user chooses a different column or free order.
 */
function hasActionableTarget(row: AllocationRow): boolean {
  return row.hasPosition && row.targetWeight !== null;
}

/** Rows with no value for the sorted column always sink to the bottom. */
export function compareRows(
  a: AllocationRow,
  b: AllocationRow,
  sort: AllocationSort,
  nextResults: ReadonlyMap<string, NextResult> = new Map(),
): number {
  if (sort.id === "score") {
    const targetPriority =
      Number(hasActionableTarget(b)) - Number(hasActionableTarget(a));

    if (targetPriority !== 0) {
      return targetPriority;
    }
  }

  const left = sortableValue(a, sort.id, nextResults);
  const right = sortableValue(b, sort.id, nextResults);

  if (left === null || right === null) {
    if (left === right) {
      return a.ticker.localeCompare(b.ticker);
    }

    return left === null ? 1 : -1;
  }

  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));

  return (
    (sort.direction === "asc" ? result : -result) ||
    a.ticker.localeCompare(b.ticker)
  );
}
