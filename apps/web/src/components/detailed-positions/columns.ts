import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { COLUMN_IDS, type ColumnId } from "./types";

const COLUMN_STORAGE_KEY = "portfolio.detailedPositions.columns.v3";
const PREVIOUS_COLUMN_STORAGE_KEY = "portfolio.detailedPositions.columns.v2";
const LEGACY_COLUMN_STORAGE_KEY = "portfolio.detailedPositions.columns";

export const PRESETS: Record<"compact" | "standard" | "all", ColumnId[]> = {
  compact: [
    "ticker",
    "quantity",
    "averagePrice",
    "marketPrice",
    "marketValue",
    "unrealizedPnl",
  ],
  standard: [
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
  ],
  all: [...COLUMN_IDS],
};

export type PresetName = keyof typeof PRESETS;

export function initialColumns(): Set<ColumnId> {
  try {
    const stored = localStorage.getItem(COLUMN_STORAGE_KEY);
    const parsed: unknown = JSON.parse(
      stored ??
        localStorage.getItem(PREVIOUS_COLUMN_STORAGE_KEY) ??
        localStorage.getItem(LEGACY_COLUMN_STORAGE_KEY) ??
        "null",
    );
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((value): value is ColumnId =>
        COLUMN_IDS.includes(value as ColumnId),
      );
      if (valid.includes("ticker")) {
        if (stored == null && !valid.includes("returnContribution")) {
          const returnIndex = valid.indexOf("unrealizedPnlPercent");
          valid.splice(
            returnIndex < 0 ? valid.length : returnIndex + 1,
            0,
            "returnContribution",
          );
          localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(valid));
        }
        return new Set(valid);
      }
    }
  } catch {
    // Storage is only a convenience; the standard preset remains available.
  }
  return new Set(PRESETS.standard);
}

export function persistColumns(columns: Set<ColumnId>): void {
  try {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify([...columns]));
  } catch {
    // The preference still applies for the current session.
  }
}

export function columnLabels(i18n: I18n): Record<ColumnId, string> {
  return {
    ticker: i18n._(t({ id: "detailedPositions.colTicker", message: "Ticker" })),
    assetClass: i18n._(
      t({
        id: "detailedPositions.colClass",
        message: "Class",
      }),
    ),
    currency: i18n._(
      t({
        id: "detailedPositions.colCurrency",
        message: "Currency",
      }),
    ),
    quantity: i18n._(
      t({
        id: "detailedPositions.colQuantity",
        message: "Quantity",
      }),
    ),
    averagePrice: i18n._(
      t({
        id: "detailedPositions.colAvgPrice",
        message: "Avg. cost",
      }),
    ),
    investedCost: i18n._(
      t({
        id: "detailedPositions.colInvested",
        message: "Invested",
      }),
    ),
    marketPrice: i18n._(
      t({
        id: "detailedPositions.colPrice",
        message: "Market price",
      }),
    ),
    marketValue: i18n._(
      t({
        id: "detailedPositions.colValue",
        message: "Market value",
      }),
    ),
    unrealizedPnl: i18n._(
      t({
        id: "detailedPositions.colOpenResult",
        message: "Open result",
      }),
    ),
    unrealizedPnlPercent: i18n._(
      t({
        id: "detailedPositions.colReturn",
        message: "Return",
      }),
    ),
    returnContribution: i18n._(
      t({
        id: "detailedPositions.colReturnContribution",
        message: "Return impact",
      }),
    ),
    weight: i18n._(
      t({
        id: "detailedPositions.colWeight",
        message: "Portfolio share",
      }),
    ),
    realizedPnl: i18n._(
      t({
        id: "detailedPositions.colRealized",
        message: "Realized P&L",
      }),
    ),
    transactionCount: i18n._(
      t({
        id: "detailedPositions.colTrades",
        message: "Trades",
      }),
    ),
    lastTradedAt: i18n._(
      t({
        id: "detailedPositions.colLastTrade",
        message: "Last trade",
      }),
    ),
    quoteAsOf: i18n._(
      t({
        id: "detailedPositions.colQuoteDate",
        message: "Quote date",
      }),
    ),
  };
}
