import { ptaxOnOrBefore, saoPauloToday } from "./bcb-ptax";
import { getFxProvider } from "./index";
import type { FxSeriesPoint } from "./provider";

/** Trade-date conversions use the official PTAX, never the display source. */
const TRADE_FX_SOURCE = "bcb_ptax" as const;
/** Reaches back past a holiday run before the earliest requested day. */
const LOOKBACK_DAYS = 10;

function shiftDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * PTAX for each trade day (or the business day before it) from a single
 * range request. Days the provider cannot cover yet are simply absent:
 * future dates, and today until its PTAX is published — carrying
 * yesterday's close into a trade made today would store the wrong rate
 * for good. Provider failures throw, so a caller can tell "not available"
 * from "BCB is down".
 */
export async function tradeDateRates(
  days: readonly string[],
  today: string = saoPauloToday(),
): Promise<Map<string, FxSeriesPoint>> {
  const sorted = [...new Set(days)].filter((day) => day <= today).sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  const rates = new Map<string, FxSeriesPoint>();
  const provider = getFxProvider(TRADE_FX_SOURCE);

  if (!first || !last || !provider) {
    return rates;
  }

  const points = await provider.getSeries({
    from: "USD",
    to: "BRL",
    start: shiftDays(first, -LOOKBACK_DAYS),
    end: last,
  });

  for (const day of sorted) {
    const point = ptaxOnOrBefore(points, day);

    if (point && (day < today || point.asOf === day)) {
      rates.set(day, point);
    }
  }

  return rates;
}

/**
 * The PTAX of one trade day, or `null` when it cannot be resolved right now.
 * A write never fails because BCB is unreachable: the trade is stored
 * without a rate and can be filled later from the Transactions screen.
 */
export async function tradeDateRateOrNull(day: string): Promise<string | null> {
  try {
    return (await tradeDateRates([day])).get(day)?.rate ?? null;
  } catch {
    return null;
  }
}
