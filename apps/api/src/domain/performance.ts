import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import {
  add,
  type Decimal,
  div,
  formatDecimal,
  isZero,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../lib/decimal";
import {
  type ConsolidationInput,
  consolidatePositions,
  convertMoney,
  filterTransactionsByAsOf,
} from "./positions";

const MONEY_PLACES = 2;
/** Ratios (returns, weights) keep more digits than money. */
const RATE_PLACES = 6;
const ONE = toDecimal("1");
const MS_PER_DAY = 86_400_000;
const API_TIME_ZONE = "America/Sao_Paulo";

/** Today in the API timezone, `YYYY-MM-DD`. */
export function apiToday(now: Date = new Date()): string {
  // `en-CA` renders ISO-ordered calendar dates.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: API_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split("-").map(Number);

  return Math.floor(Date.UTC(year, month - 1, date) / MS_PER_DAY);
}

export type PerformanceSnapshotDate = {
  /** `YYYY-MM` bucket. */
  key: string;
  /** Valuation day: month end, or today for the running month. */
  asOf: string;
  /**
   * The month-end before the window. It is valued to give the first monthly
   * return a starting value, and is not part of the returned series.
   */
  baseline: boolean;
};

/**
 * `months` valuation dates ending today, preceded by one baseline month-end.
 * Calendar month boundaries are identical in every timezone, so UTC date
 * math is safe once "today" is resolved in the API timezone.
 */
export function performanceSnapshots(
  months: number,
  now: Date = new Date(),
): PerformanceSnapshotDate[] {
  const today = apiToday(now);
  const [year, month] = today.split("-").map(Number);
  const snapshots: PerformanceSnapshotDate[] = [];

  for (let back = months; back >= 0; back -= 1) {
    const first = new Date(Date.UTC(year, month - 1 - back, 1));
    const snapshotYear = first.getUTCFullYear();
    const snapshotMonth = first.getUTCMonth();
    const key = `${snapshotYear}-${String(snapshotMonth + 1).padStart(2, "0")}`;
    const lastDay = new Date(
      Date.UTC(snapshotYear, snapshotMonth + 1, 0),
    ).getUTCDate();

    snapshots.push({
      key,
      asOf: back === 0 ? today : `${key}-${String(lastDay).padStart(2, "0")}`,
      baseline: back === months,
    });
  }

  return snapshots;
}

/** Native-currency close for a ticker at a day, or `null` when unquoted. */
export type PerformancePriceLookup = (
  ticker: string,
  day: string,
) => string | null;

/** BRL per 1 USD at a day, or `null` when no rate is known. */
export type PerformanceRateLookup = (day: string) => string | null;

export type PerformanceBuildInput = {
  transactions: readonly ConsolidationInput[];
  /** Ascending; the first entry must be the baseline. */
  snapshots: readonly PerformanceSnapshotDate[];
  displayCurrency: Currency;
  priceAt: PerformancePriceLookup;
  rateAt: PerformanceRateLookup;
};

export type PerformanceMonthClass = {
  assetClass: AssetClass;
  marketValue: string;
};

export type PerformanceMonth = {
  key: string;
  asOf: string;
  /** Portfolio value: quoted holdings plus unquoted ones carried at cost. */
  marketValue: string;
  /** Cost basis of the open positions at this snapshot. */
  investedCost: string;
  /** Part of `marketValue` that had no quote and is carried at cost. */
  costFallbackValue: string;
  /** Net cash invested during the month (buys minus sell proceeds). */
  netFlow: string;
  /** Net cash invested since the start of the window. */
  cumulativeNetFlow: string;
  /** Realized result booked since the start of the window. */
  realizedPnl: string;
  /** Open result at this snapshot (`marketValue - investedCost`). */
  unrealizedPnl: string;
  /** Modified Dietz return for the month, `null` when there is no base. */
  monthlyReturn: string | null;
  /** Compounded return since the start of the window. */
  cumulativeReturn: string | null;
  /** Distance from the peak of the compounded curve, `0` or negative. */
  drawdown: string | null;
  openPositions: number;
  unquotedPositions: number;
  usdBrlRate: string | null;
  byAssetClass: PerformanceMonthClass[];
};

export type PerformanceClassBreakdown = {
  assetClass: AssetClass;
  marketValue: string;
  investedCost: string;
  unrealizedPnl: string;
  /** Open result over this class' cost basis. */
  unrealizedPnlPercent: string | null;
  /** Realized result booked inside the window. */
  realizedPnl: string;
  /** Share of the portfolio value, `0`–`1`. */
  weight: string | null;
  /**
   * Open result over the whole portfolio cost basis: how many percentage
   * points of the portfolio return come from this class.
   */
  contribution: string | null;
  positions: number;
  unquotedPositions: number;
};

export type PerformanceAssetBreakdown = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  marketValue: string;
  investedCost: string;
  unrealizedPnl: string;
  unrealizedPnlPercent: string | null;
  realizedPnl: string;
  contribution: string | null;
  /** True when the position is carried at cost for lack of a quote. */
  quoteMissing: boolean;
};

export type PerformanceMonthMark = {
  key: string;
  asOf: string;
  returnPercent: string;
};

export type PerformanceSummary = {
  displayCurrency: Currency;
  /** First and last month of the window, `YYYY-MM`. */
  from: string;
  to: string;
  /** Valuation day of the last snapshot. */
  asOf: string;
  months: number;
  monthsWithReturn: number;
  currentValue: string;
  investedCost: string;
  /** Net cash invested inside the window. */
  netInvested: string;
  unrealizedPnl: string;
  unrealizedPnlPercent: string | null;
  /** Realized result booked inside the window. */
  realizedPnl: string;
  /** Time-weighted return over the window, immune to contribution timing. */
  cumulativeReturn: string | null;
  /** `cumulativeReturn` restated per year, `null` for windows under 6 months. */
  annualizedReturn: string | null;
  bestMonth: PerformanceMonthMark | null;
  worstMonth: PerformanceMonthMark | null;
  positiveMonths: number;
  negativeMonths: number;
  /** Deepest drop of the compounded curve, `0` or negative. */
  maxDrawdown: string | null;
  /** Open positions carried at cost at the last snapshot. */
  unquotedPositions: number;
  usdBrlRate: string | null;
};

export type PerformanceHistory = {
  months: PerformanceMonth[];
  summary: PerformanceSummary;
  byAssetClass: PerformanceClassBreakdown[];
  byAsset: PerformanceAssetBreakdown[];
};

type ClassTotals = {
  marketValue: Decimal;
  investedCost: Decimal;
  realizedPnl: Decimal;
  positions: number;
  unquoted: number;
};

type TickerTotals = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  marketValue: Decimal;
  investedCost: Decimal;
  realizedPnl: Decimal;
  quoteMissing: boolean;
};

type SnapshotValuation = {
  date: PerformanceSnapshotDate;
  marketValue: Decimal;
  investedCost: Decimal;
  costFallbackValue: Decimal;
  realizedPnl: Decimal;
  openPositions: number;
  unquotedPositions: number;
  usdBrlRate: string | null;
  byAssetClass: Map<AssetClass, ClassTotals>;
  byTicker: Map<string, TickerTotals>;
};

function emptyClassTotals(): ClassTotals {
  return {
    marketValue: ZERO,
    investedCost: ZERO,
    realizedPnl: ZERO,
    positions: 0,
    unquoted: 0,
  };
}

/**
 * Values every position held at `date` and aggregates the snapshot by asset
 * class and by ticker. Positions without a quote are carried at cost so the
 * value curve stays continuous; they are counted so the UI can disclose it.
 */
function valueSnapshot(
  input: PerformanceBuildInput,
  date: PerformanceSnapshotDate,
): SnapshotValuation {
  const positions = consolidatePositions(
    filterTransactionsByAsOf(input.transactions, date.asOf),
  );
  const rate = input.rateAt(date.asOf);
  const convert = (value: string, currency: Currency): Decimal => {
    if (currency === input.displayCurrency) {
      return toDecimal(value);
    }

    if (rate == null) {
      throw new Error(`No USD/BRL rate available for ${date.asOf}`);
    }

    return toDecimal(
      convertMoney(value, currency, input.displayCurrency, rate),
    );
  };

  const valuation: SnapshotValuation = {
    date,
    marketValue: ZERO,
    investedCost: ZERO,
    costFallbackValue: ZERO,
    realizedPnl: ZERO,
    openPositions: 0,
    unquotedPositions: 0,
    usdBrlRate: rate,
    byAssetClass: new Map(),
    byTicker: new Map(),
  };

  for (const position of positions) {
    const realized = convert(position.realizedPnl, position.currency);
    valuation.realizedPnl = add(valuation.realizedPnl, realized);

    const open = !isZero(toDecimal(position.quantity));
    const close = open ? input.priceAt(position.ticker, date.asOf) : null;
    const investedCost = open
      ? convert(position.investedCost, position.currency)
      : ZERO;
    const marketValue = open
      ? close == null
        ? investedCost
        : convert(
            formatDecimal(
              mul(toDecimal(position.quantity), toDecimal(close)),
              MONEY_PLACES,
            ),
            position.currency,
          )
      : ZERO;

    if (open) {
      valuation.openPositions += 1;
      valuation.marketValue = add(valuation.marketValue, marketValue);
      valuation.investedCost = add(valuation.investedCost, investedCost);

      if (close == null) {
        valuation.unquotedPositions += 1;
        valuation.costFallbackValue = add(
          valuation.costFallbackValue,
          investedCost,
        );
      }
    }

    const classTotals =
      valuation.byAssetClass.get(position.assetClass) ?? emptyClassTotals();
    classTotals.marketValue = add(classTotals.marketValue, marketValue);
    classTotals.investedCost = add(classTotals.investedCost, investedCost);
    classTotals.realizedPnl = add(classTotals.realizedPnl, realized);

    if (open) {
      classTotals.positions += 1;

      if (close == null) {
        classTotals.unquoted += 1;
      }
    }

    valuation.byAssetClass.set(position.assetClass, classTotals);
    valuation.byTicker.set(position.ticker, {
      ticker: position.ticker,
      assetClass: position.assetClass,
      currency: position.currency,
      marketValue,
      investedCost,
      realizedPnl: realized,
      quoteMissing: open && close == null,
    });
  }

  return valuation;
}

/** Cash moved by one trade: fees increase a buy and reduce a sell. */
function tradeCash(entry: ConsolidationInput): Decimal {
  const gross = mul(toDecimal(entry.quantity), toDecimal(entry.price));
  const fees = toDecimal(entry.fees);

  return entry.side === "buy" ? add(gross, fees) : -sub(gross, fees);
}

type MonthFlows = { total: Decimal; weighted: Decimal };

/**
 * Cash flows inside `(previous, current]`, converted to the display currency
 * at the rate of their own trade day and weighted by the share of the period
 * they were invested (`Modified Dietz`): a contribution on the last day of
 * the month barely counts towards the month's return base.
 */
function monthFlows(
  input: PerformanceBuildInput,
  previous: string,
  current: string,
): MonthFlows {
  const start = dayNumber(previous);
  const span = dayNumber(current) - start;
  let total = ZERO;
  let weighted = ZERO;

  for (const entry of input.transactions) {
    if (entry.tradedAt <= previous || entry.tradedAt > current) {
      continue;
    }

    const native = formatDecimal(tradeCash(entry), MONEY_PLACES);
    let amount: Decimal;

    if (entry.currency === input.displayCurrency) {
      amount = toDecimal(native);
    } else {
      const rate = input.rateAt(entry.tradedAt) ?? input.rateAt(current);

      if (rate == null) {
        throw new Error(`No USD/BRL rate available for ${entry.tradedAt}`);
      }

      amount = toDecimal(
        convertMoney(native, entry.currency, input.displayCurrency, rate),
      );
    }

    const elapsed = dayNumber(entry.tradedAt) - start;
    const weight =
      span <= 0
        ? ZERO
        : div(toDecimal(String(span - elapsed)), toDecimal(String(span)));

    total = add(total, amount);
    weighted = add(weighted, mul(amount, weight));
  }

  return { total, weighted };
}

/**
 * Monthly return by the Modified Dietz method:
 * `(end - start - flows) / (start + weighted flows)`. It removes the effect
 * of contribution size and timing, so compounding the months gives a
 * time-weighted return comparable to a benchmark.
 */
function modifiedDietz(
  startValue: Decimal,
  endValue: Decimal,
  flows: MonthFlows,
): Decimal | null {
  const base = add(startValue, flows.weighted);

  if (base <= ZERO) {
    return null;
  }

  return div(sub(sub(endValue, startValue), flows.total), base);
}

/** Fixed-point ratio out of `Math.pow`, used only for annualization. */
function annualize(cumulative: Decimal, months: number): string | null {
  if (months < 6) {
    return null;
  }

  const growth = Number(formatDecimal(add(ONE, cumulative), RATE_PLACES));

  if (!Number.isFinite(growth) || growth <= 0) {
    return null;
  }

  const annualized = growth ** (12 / months) - 1;

  if (!Number.isFinite(annualized)) {
    return null;
  }

  return formatDecimal(toDecimal(annualized.toFixed(RATE_PLACES)), RATE_PLACES);
}

function ratio(numerator: Decimal, denominator: Decimal): string | null {
  return denominator <= ZERO
    ? null
    : formatDecimal(div(numerator, denominator), RATE_PLACES);
}

/**
 * Turns a transaction log into a monthly performance history: portfolio
 * value, contributions, open and realized results, per-month time-weighted
 * returns, the compounded curve with its drawdown, and the current
 * breakdown by asset class and by asset.
 *
 * Every valuation is done in the display currency at the rate of the
 * snapshot day, so the curve reflects what the portfolio was worth to the
 * user at each month end, FX moves included.
 */
export function buildPerformanceHistory(
  input: PerformanceBuildInput,
): PerformanceHistory {
  const [baseline, ...window] = input.snapshots;

  if (!baseline || window.length === 0) {
    throw new Error("A performance window needs a baseline and one month");
  }

  const baselineValuation = valueSnapshot(input, baseline);
  const months: PerformanceMonth[] = [];

  let previous = baselineValuation;
  let cumulativeFlow = ZERO;
  let wealthIndex = ONE;
  let peakIndex = ONE;
  let maxDrawdown: Decimal | null = null;
  let monthsWithReturn = 0;
  let positiveMonths = 0;
  let negativeMonths = 0;
  let best: PerformanceMonthMark | null = null;
  let worst: PerformanceMonthMark | null = null;
  let last = baselineValuation;

  for (const date of window) {
    const valuation = valueSnapshot(input, date);
    const flows = monthFlows(input, previous.date.asOf, date.asOf);
    const monthlyReturn = modifiedDietz(
      previous.marketValue,
      valuation.marketValue,
      flows,
    );

    cumulativeFlow = add(cumulativeFlow, flows.total);

    let cumulativeReturn: string | null = null;
    let drawdown: string | null = null;

    if (monthlyReturn != null) {
      monthsWithReturn += 1;
      wealthIndex = mul(wealthIndex, add(ONE, monthlyReturn));

      if (wealthIndex > peakIndex) {
        peakIndex = wealthIndex;
      }

      const currentDrawdown =
        peakIndex <= ZERO ? ZERO : sub(div(wealthIndex, peakIndex), ONE);

      if (maxDrawdown == null || currentDrawdown < maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      const mark: PerformanceMonthMark = {
        key: date.key,
        asOf: date.asOf,
        returnPercent: formatDecimal(monthlyReturn, RATE_PLACES),
      };

      if (monthlyReturn > ZERO) {
        positiveMonths += 1;
      } else if (monthlyReturn < ZERO) {
        negativeMonths += 1;
      }

      if (!best || monthlyReturn > toDecimal(best.returnPercent)) {
        best = mark;
      }

      if (!worst || monthlyReturn < toDecimal(worst.returnPercent)) {
        worst = mark;
      }

      cumulativeReturn = formatDecimal(sub(wealthIndex, ONE), RATE_PLACES);
      drawdown = formatDecimal(currentDrawdown, RATE_PLACES);
    }

    months.push({
      key: date.key,
      asOf: date.asOf,
      marketValue: formatDecimal(valuation.marketValue, MONEY_PLACES),
      investedCost: formatDecimal(valuation.investedCost, MONEY_PLACES),
      costFallbackValue: formatDecimal(
        valuation.costFallbackValue,
        MONEY_PLACES,
      ),
      netFlow: formatDecimal(flows.total, MONEY_PLACES),
      cumulativeNetFlow: formatDecimal(cumulativeFlow, MONEY_PLACES),
      realizedPnl: formatDecimal(
        sub(valuation.realizedPnl, baselineValuation.realizedPnl),
        MONEY_PLACES,
      ),
      unrealizedPnl: formatDecimal(
        sub(valuation.marketValue, valuation.investedCost),
        MONEY_PLACES,
      ),
      monthlyReturn:
        monthlyReturn == null
          ? null
          : formatDecimal(monthlyReturn, RATE_PLACES),
      cumulativeReturn,
      drawdown,
      openPositions: valuation.openPositions,
      unquotedPositions: valuation.unquotedPositions,
      usdBrlRate: valuation.usdBrlRate,
      byAssetClass: [...valuation.byAssetClass.entries()]
        .filter(([, totals]) => !isZero(totals.marketValue))
        .map(([assetClass, totals]) => ({
          assetClass,
          marketValue: formatDecimal(totals.marketValue, MONEY_PLACES),
        }))
        .sort((a, b) => a.assetClass.localeCompare(b.assetClass)),
    });

    previous = valuation;
    last = valuation;
  }

  const unrealized = sub(last.marketValue, last.investedCost);
  const windowRealized = sub(last.realizedPnl, baselineValuation.realizedPnl);

  const byAssetClass: PerformanceClassBreakdown[] = [
    ...last.byAssetClass.entries(),
  ]
    .filter(
      ([, totals]) =>
        !isZero(totals.marketValue) ||
        !isZero(totals.investedCost) ||
        !isZero(totals.realizedPnl),
    )
    .map(([assetClass, totals]) => {
      const classUnrealized = sub(totals.marketValue, totals.investedCost);
      const baselineRealized =
        baselineValuation.byAssetClass.get(assetClass)?.realizedPnl ?? ZERO;

      return {
        assetClass,
        marketValue: formatDecimal(totals.marketValue, MONEY_PLACES),
        investedCost: formatDecimal(totals.investedCost, MONEY_PLACES),
        unrealizedPnl: formatDecimal(classUnrealized, MONEY_PLACES),
        unrealizedPnlPercent: ratio(classUnrealized, totals.investedCost),
        realizedPnl: formatDecimal(
          sub(totals.realizedPnl, baselineRealized),
          MONEY_PLACES,
        ),
        weight: ratio(totals.marketValue, last.marketValue),
        contribution: ratio(classUnrealized, last.investedCost),
        positions: totals.positions,
        unquotedPositions: totals.unquoted,
      };
    })
    .sort((a, b) => Number(b.marketValue) - Number(a.marketValue));

  const byAsset: PerformanceAssetBreakdown[] = [...last.byTicker.values()]
    .filter(
      (totals) =>
        !isZero(totals.marketValue) ||
        !isZero(totals.investedCost) ||
        !isZero(totals.realizedPnl),
    )
    .map((totals) => {
      const assetUnrealized = sub(totals.marketValue, totals.investedCost);
      const baselineRealized =
        baselineValuation.byTicker.get(totals.ticker)?.realizedPnl ?? ZERO;

      return {
        ticker: totals.ticker,
        assetClass: totals.assetClass,
        currency: totals.currency,
        marketValue: formatDecimal(totals.marketValue, MONEY_PLACES),
        investedCost: formatDecimal(totals.investedCost, MONEY_PLACES),
        unrealizedPnl: formatDecimal(assetUnrealized, MONEY_PLACES),
        unrealizedPnlPercent: ratio(assetUnrealized, totals.investedCost),
        realizedPnl: formatDecimal(
          sub(totals.realizedPnl, baselineRealized),
          MONEY_PLACES,
        ),
        contribution: ratio(assetUnrealized, last.investedCost),
        quoteMissing: totals.quoteMissing,
      };
    })
    .sort((a, b) => Number(b.unrealizedPnl) - Number(a.unrealizedPnl));

  const first = window[0];
  const lastMonth = window[window.length - 1];

  return {
    months,
    summary: {
      displayCurrency: input.displayCurrency,
      from: first.key,
      to: lastMonth.key,
      asOf: lastMonth.asOf,
      months: window.length,
      monthsWithReturn,
      currentValue: formatDecimal(last.marketValue, MONEY_PLACES),
      investedCost: formatDecimal(last.investedCost, MONEY_PLACES),
      netInvested: formatDecimal(cumulativeFlow, MONEY_PLACES),
      unrealizedPnl: formatDecimal(unrealized, MONEY_PLACES),
      unrealizedPnlPercent: ratio(unrealized, last.investedCost),
      realizedPnl: formatDecimal(windowRealized, MONEY_PLACES),
      cumulativeReturn:
        monthsWithReturn === 0
          ? null
          : formatDecimal(sub(wealthIndex, ONE), RATE_PLACES),
      annualizedReturn:
        monthsWithReturn === 0
          ? null
          : annualize(sub(wealthIndex, ONE), monthsWithReturn),
      bestMonth: best,
      worstMonth: worst,
      positiveMonths,
      negativeMonths,
      maxDrawdown:
        maxDrawdown == null ? null : formatDecimal(maxDrawdown, RATE_PLACES),
      unquotedPositions: last.unquotedPositions,
      usdBrlRate: last.usdBrlRate,
    },
    byAssetClass,
    byAsset,
  };
}

/**
 * Lookup over an ascending dated series: returns the last value at or
 * before `day`, which resolves month ends that fall on weekends or holidays
 * to the previous session. Days before the series start have no value.
 */
export function createSeriesLookup<T extends { asOf: string }>(
  points: readonly T[],
): (day: string) => T | null {
  const sorted = [...points].sort((a, b) => a.asOf.localeCompare(b.asOf));

  return (day: string) => {
    let low = 0;
    let high = sorted.length - 1;
    let found: T | null = null;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const candidate = sorted[middle];

      if (candidate.asOf <= day) {
        found = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return found;
  };
}
