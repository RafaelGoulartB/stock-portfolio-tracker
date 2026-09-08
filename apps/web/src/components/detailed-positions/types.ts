import type { RouterOutputs } from "@/lib/api";

export type DetailedPosition =
  RouterOutputs["positions"]["list"]["positions"][number];

export type PositionsSummary = RouterOutputs["positions"]["list"]["summary"];

export const COLUMN_IDS = [
  "ticker",
  "assetClass",
  "currency",
  "quantity",
  "averagePrice",
  "investedCost",
  "marketPrice",
  "marketValue",
  "unrealizedPnl",
  "unrealizedPnlPercent",
  "returnContribution",
  "weight",
  "realizedPnl",
  "transactionCount",
  "lastTradedAt",
  "quoteAsOf",
] as const;

export type ColumnId = (typeof COLUMN_IDS)[number];
export type SortDirection = "asc" | "desc";
export type SortState = { id: ColumnId; direction: SortDirection };
