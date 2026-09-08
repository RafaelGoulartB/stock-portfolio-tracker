import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

/** Sortable columns, in render order. The quarter grid follows them. */
export const ALLOCATION_COLUMNS = [
  "ticker",
  "targetWeight",
  "currentWeight",
  "gapWeight",
  "discount",
  "score",
  "nextResult",
  "lastContributionAt",
  "quantity",
  "marketValue",
  "averageGrade",
] as const;

export type AllocationColumn = (typeof ALLOCATION_COLUMNS)[number];
export type SortDirection = "asc" | "desc";
export type AllocationSort = { id: AllocationColumn; direction: SortDirection };

/** Columns that read better ascending on first click. */
const ASCENDING_FIRST: AllocationColumn[] = [
  "ticker",
  "nextResult",
  "lastContributionAt",
];

export function defaultSortDirection(id: AllocationColumn): SortDirection {
  return ASCENDING_FIRST.includes(id) ? "asc" : "desc";
}

export function columnLabels(i18n: I18n): Record<AllocationColumn, string> {
  return {
    ticker: i18n._(t({ id: "allocation.colTicker", message: "Asset" })),
    targetWeight: i18n._(t({ id: "allocation.colTarget", message: "Target" })),
    currentWeight: i18n._(
      t({ id: "allocation.colCurrent", message: "Current" }),
    ),
    gapWeight: i18n._(t({ id: "allocation.colGap", message: "Gap" })),
    score: i18n._(t({ id: "allocation.colScore", message: "Score" })),
    nextResult: i18n._(
      t({ id: "allocation.colNextResult", message: "Next result" }),
    ),
    averageGrade: i18n._(t({ id: "allocation.colGrade", message: "Grade" })),
    discount: i18n._(t({ id: "allocation.colDiscount", message: "Discount" })),
    lastContributionAt: i18n._(
      t({ id: "allocation.colLastBuy", message: "Last buy" }),
    ),
    quantity: i18n._(t({ id: "allocation.colQuantity", message: "Shares" })),
    marketValue: i18n._(t({ id: "allocation.colValue", message: "Value" })),
  };
}
