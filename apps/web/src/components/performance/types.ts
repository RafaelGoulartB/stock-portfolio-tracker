import type { AssetClass } from "@portifolio-tracker/shared";
import type { RouterOutputs } from "@/lib/api";
import {
  type CurrencyCode,
  formatMoney,
  formatSignedMoney,
} from "@/lib/format";

export type PerformanceData = RouterOutputs["performance"]["history"];
export type PerformanceSummary = PerformanceData["summary"];
export type ClassBreakdown = PerformanceData["byAssetClass"][number];
export type AssetBreakdown = PerformanceData["byAsset"][number];

export type MonthRow = {
  key: string;
  /** Axis label: short month, with the year on every January. */
  label: string;
  /** Tooltip label: month and year. */
  fullLabel: string;
  marketValue: number;
  investedCost: number;
  netFlow: number;
  cumulativeNetFlow: number;
  unrealizedPnl: number;
  monthlyReturn: number | null;
  cumulativeReturn: number | null;
} & Partial<Record<AssetClass, number>>;

export type Category = { assetClass: AssetClass; color: string };

/** Same categorical palette as the allocation donut. */
export const CATEGORY_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
];

function monthDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, 1));
}

export function fullMonthLabel(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(monthDate(key));
}

/** Short month for a dense axis; January carries the year to stay readable. */
export function axisMonthLabel(key: string, locale: string): string {
  const date = monthDate(key);
  const month = new Intl.DateTimeFormat(locale, {
    month: "short",
    timeZone: "UTC",
  }).format(date);

  return date.getUTCMonth() === 0
    ? `${month} ${String(date.getUTCFullYear()).slice(2)}`
    : month;
}

export function signedOrZero(value: string, currency: CurrencyCode): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}
