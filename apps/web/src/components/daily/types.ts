import type { RouterOutputs } from "@/lib/api";
import { formatMoney, formatSignedMoney } from "@/lib/format";

export type DailyData = RouterOutputs["positions"]["daily"];
export type DailySummaryData = DailyData["summary"];
export type DailyPosition = DailyData["positions"][number];
export type DailyCurrency = DailySummaryData["displayCurrency"];

/** A daily move this large saturates the market-map color scale. */
export const DAILY_HEAT_CAP = 0.03;

export function signedOrZero(value: string, currency: DailyCurrency): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

/** Positions worth showing on a map or list: quoted, non-zero, not cash. */
export function marketPositions(data: DailyData): DailyPosition[] {
  return data.positions.filter(
    (position) =>
      position.assetClass !== "cash" &&
      position.convertedMarketValue != null &&
      Number(position.convertedMarketValue) > 0,
  );
}

/** Share of yesterday's comparable book that one asset's move represents. */
export function portfolioImpact(
  position: DailyPosition,
  previousPortfolioValue: string,
): number | null {
  const base = Number(previousPortfolioValue);

  return position.dailyChange == null || base === 0
    ? null
    : Number(position.dailyChange) / base;
}
