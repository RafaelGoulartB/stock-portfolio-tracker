import type { AssetClass } from "@portifolio-tracker/shared";

/**
 * One color per asset class, shared by every chart so a class keeps its
 * color from screen to screen. `--chart-6` is skipped on purpose: its orange
 * sits too close to the REIT one when the two are adjacent.
 */
export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  stock_br: "var(--chart-1)",
  stock_us: "var(--chart-2)",
  reit: "var(--chart-3)",
  etf: "var(--chart-4)",
  bdr: "var(--chart-5)",
  crypto: "var(--chart-8)",
  fixed_income: "var(--chart-7)",
  cash: "var(--chart-10)",
  other: "var(--chart-9)",
};
