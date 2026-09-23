import {
  type AllocationMarkColor,
  type AssetClass,
  allocationMarkColorSchema,
} from "@portifolio-tracker/shared";
import type { AllocationAssetMeta } from "../../domain/allocation";

const API_TIME_ZONE = "America/Sao_Paulo";

/** Today in the API timezone, `YYYY-MM-DD`, so cooldowns match the log. */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: API_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Inclusive start of an N-month lookback, `YYYY-MM-DD`. */
export function monthsAgo(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1 - months, date ?? 1),
  );

  return shifted.toISOString().slice(0, 10);
}

/** Rows written before the BR/US stock split still read back as `stock`. */
export function normalizeAssetClass(value: string): AssetClass {
  return (value === "stock" ? "stock_br" : value) as AssetClass;
}

export function parseMarkColor(
  value: string | null,
): AllocationMarkColor | null {
  if (value === null) return null;

  const parsed = allocationMarkColorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function storedManualPrices(
  assets: readonly AllocationAssetMeta[],
): Record<string, string> {
  return Object.fromEntries(
    assets
      .filter((asset) => asset.manualPrice !== null)
      .map((asset) => [asset.ticker, asset.manualPrice as string]),
  );
}
