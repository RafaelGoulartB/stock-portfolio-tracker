import type { ColumnId, DetailedPosition, SortDirection } from "./types";

export function comparePositions(
  a: DetailedPosition,
  b: DetailedPosition,
  id: ColumnId,
  direction: SortDirection,
) {
  const left = sortableValue(a, id);
  const right = sortableValue(b, id);
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left ?? "").localeCompare(String(right ?? ""));
  return direction === "asc" ? result : -result;
}

function sortableValue(
  position: DetailedPosition,
  id: ColumnId,
): string | number | null {
  switch (id) {
    case "ticker":
      return position.ticker;
    case "assetClass":
      return position.assetClass;
    case "currency":
      return position.currency;
    case "quantity":
      return Number(position.quantity);
    case "averagePrice":
      return Number(position.averagePrice);
    case "investedCost":
      return Number(position.convertedInvestedCost);
    case "marketPrice":
      return position.marketPrice == null ? null : Number(position.marketPrice);
    case "marketValue":
      return position.convertedMarketValue == null
        ? null
        : Number(position.convertedMarketValue);
    case "unrealizedPnl":
      return position.convertedUnrealizedPnl == null
        ? null
        : Number(position.convertedUnrealizedPnl);
    case "unrealizedPnlPercent":
      return position.unrealizedPnlPercent == null
        ? null
        : Number(position.unrealizedPnlPercent);
    case "returnContribution":
      return position.returnContribution == null
        ? null
        : Number(position.returnContribution);
    case "weight":
      return position.weight == null ? null : Number(position.weight);
    case "realizedPnl":
      return Number(position.convertedRealizedPnl);
    case "transactionCount":
      return position.transactionCount;
    case "lastTradedAt":
      return position.lastTradedAt;
    case "quoteAsOf":
      return position.quoteAsOf;
  }
}
