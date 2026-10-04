import { Trans } from "@lingui/react/macro";
import type { DeepFinderWindow } from "@portifolio-tracker/shared";
import type { ReactNode } from "react";
import type { RouterOutputs } from "@/lib/api";
import { formatMoney, formatSignedMoney } from "@/lib/format";

export type WindowsData = RouterOutputs["positions"]["finderWindows"];
export type WindowsRow = WindowsData["positions"][number];
export type WindowSummary = WindowsData["windows"][number];
export type FinderCurrency = WindowsRow["displayCurrency"];

/**
 * Move that saturates the heat of each window. Longer windows move more,
 * so one shared scale would leave short windows colorless.
 */
export const WINDOW_HEAT_CAP: Record<DeepFinderWindow, number> = {
  cost: 0.5,
  "1d": 0.03,
  "1w": 0.06,
  "1m": 0.1,
  "3m": 0.2,
  ytd: 0.3,
  "1y": 0.4,
};

export function signedOrZero(value: string, currency: FinderCurrency): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

export function windowLabel(window: DeepFinderWindow): ReactNode {
  switch (window) {
    case "cost":
      return <Trans id="deepFinder.windowCost">Vs cost</Trans>;
    case "1d":
      return <Trans id="deepFinder.window1d">1 day</Trans>;
    case "1w":
      return <Trans id="deepFinder.window1w">1 week</Trans>;
    case "1m":
      return <Trans id="deepFinder.window1m">1 month</Trans>;
    case "3m":
      return <Trans id="deepFinder.window3m">3 months</Trans>;
    case "ytd":
      return <Trans id="deepFinder.windowYtd">YTD</Trans>;
    case "1y":
      return <Trans id="deepFinder.window1y">1 year</Trans>;
  }
}

/** Compact column header for the holdings matrix. */
export function windowShortLabel(window: DeepFinderWindow): ReactNode {
  switch (window) {
    case "cost":
      return <Trans id="deepFinder.short.cost">Cost</Trans>;
    case "1d":
      return <Trans id="deepFinder.short.1d">1D</Trans>;
    case "1w":
      return <Trans id="deepFinder.short.1w">1W</Trans>;
    case "1m":
      return <Trans id="deepFinder.short.1m">1M</Trans>;
    case "3m":
      return <Trans id="deepFinder.short.3m">3M</Trans>;
    case "ytd":
      return <Trans id="deepFinder.short.ytd">YTD</Trans>;
    case "1y":
      return <Trans id="deepFinder.short.1y">1Y</Trans>;
  }
}

export function percentOf(row: WindowsRow, window: DeepFinderWindow) {
  const value = row.moves[window].changePercent;

  return value == null ? null : Number(value);
}
