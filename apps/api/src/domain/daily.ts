import type {
  AssetClass,
  Currency,
  ValuedPosition,
} from "@portifolio-tracker/shared";
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
import { apiToday } from "./performance";
import { convertMoney, isOpenQuantity, type ValuationQuote } from "./positions";

const MONEY_PLACES = 2;
/** Daily percentages keep extra digits so small FX moves stay visible. */
const RATE_PLACES = 8;

export type DailyTrackedPosition = ValuedPosition & {
  previousClose: string | null;
  previousCloseAsOf: string | null;
  convertedPreviousMarketValue: string | null;
  dailyChange: string | null;
  dailyChangePercent: string | null;
  /**
   * Part of {@link dailyChange} caused by USD/BRL alone: today's native
   * value at today's rate minus the same value at the previous rate. The
   * rest is the price move. `null` for same-currency assets or without a
   * comparison.
   */
  dailyFxChange: string | null;
};

/** Day move of one asset class, quoted assets and cash only. */
export type DailyClassChange = {
  assetClass: AssetClass;
  marketValue: string;
  /** `null` when no asset of the class has a previous close. */
  dailyChange: string | null;
  dailyChangePercent: string | null;
  comparablePositions: number;
};

export type DailyTrackingSummary = {
  displayCurrency: Currency;
  marketValue: string;
  previousComparableValue: string;
  currentComparableValue: string;
  /**
   * `null` when open assets exist but none has a previous close: a flat
   * cash balance alone must not read as a portfolio that did not move.
   */
  dailyChange: string | null;
  dailyChangePercent: string | null;
  /**
   * Sum of every comparable position's {@link DailyTrackedPosition.dailyFxChange}.
   * `null` when no foreign-currency amount was compared.
   */
  dailyFxChange: string | null;
  /** `dailyChange - dailyFxChange`: the move of prices alone. */
  dailyPriceChange: string | null;
  /** USD/BRL move between the two sessions, `null` without both rates. */
  usdBrlChangePercent: string | null;
  /** Largest class first. */
  byAssetClass: DailyClassChange[];
  /** Breadth and coverage count quoted assets only; cash is excluded. */
  advancing: number;
  declining: number;
  unchanged: number;
  comparablePositions: number;
  openPositions: number;
  usdBrlRate: string | null;
  previousUsdBrlRate: string | null;
};

export type DailyTracking = {
  positions: DailyTrackedPosition[];
  summary: DailyTrackingSummary;
};

export type DailyTrackingInput = {
  positions: readonly ValuedPosition[];
  quotes: ReadonlyMap<string, ValuationQuote>;
  displayCurrency: Currency;
  /** Spot used to value the live book. */
  usdBrlRate: string | null;
  /**
   * USD/BRL of the previous weekday. Cash and foreign-currency previous
   * closes convert at this rate so the day includes FX, not only price.
   * When omitted, the current rate is reused and the FX day-move is zero.
   */
  previousUsdBrlRate: string | null;
};

function isUtcWeekend(day: Date): boolean {
  const weekday = day.getUTCDay();

  return weekday === 0 || weekday === 6;
}

/**
 * The weekday before `day` (`YYYY-MM-DD`). Calendar weekdays are the same
 * in every timezone once the date is already resolved.
 */
export function previousWeekday(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date));

  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (isUtcWeekend(cursor));

  return cursor.toISOString().slice(0, 10);
}

/**
 * Weekends show the latest completed common market session (Friday).
 * Weekdays return `undefined` so the live book is used.
 */
export function dailySnapshotDate(now: Date = new Date()): string | undefined {
  const today = apiToday(now);
  const [year, month, date] = today.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date));

  if (!isUtcWeekend(cursor)) {
    return undefined;
  }

  cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() === 6 ? 1 : 2));

  return cursor.toISOString().slice(0, 10);
}

/** Snapshot day on a weekend, otherwise today in the API timezone. */
export function dailyValuationDay(now: Date = new Date()): string {
  return dailySnapshotDate(now) ?? apiToday(now);
}

/**
 * Weekday whose USD/BRL rate values the previous close. Anchored on the
 * snapshot or the latest quote day so a stale overnight book still compares
 * the last completed session to the session before it, not calendar today
 * against the same ECB close.
 */
export function dailyPreviousFxDay(
  snapshotDate: string | undefined,
  latestQuoteAsOf: string | null,
  now: Date = new Date(),
): string {
  return previousWeekday(
    snapshotDate ?? latestQuoteAsOf ?? dailyValuationDay(now),
  );
}

function isCashPosition(position: ValuedPosition): boolean {
  return position.assetClass === "cash";
}

function toDisplay(
  value: string,
  from: Currency,
  display: Currency,
  usdBrlRate: string | null,
): string {
  if (from === display) {
    return formatDecimal(toDecimal(value), MONEY_PLACES);
  }

  return convertMoney(value, from, display, usdBrlRate ?? "1");
}

function ratio(numerator: Decimal, denominator: Decimal): string | null {
  return isZero(denominator)
    ? null
    : formatDecimal(div(numerator, denominator), RATE_PLACES);
}

/**
 * Daily wealth change in the display currency: today's converted value minus
 * the previous close converted at the previous weekday's USD/BRL rate.
 *
 * Same-currency amounts skip FX. Cash has no market previous close; its
 * native BRL balance is converted at both rates so a USD view still sees
 * the dollar's move against cash.
 */
export function buildDailyTracking(input: DailyTrackingInput): DailyTracking {
  const previousRate = input.previousUsdBrlRate ?? input.usdBrlRate;
  const open = input.positions.filter((position) =>
    isOpenQuantity(position.quantity),
  );

  let previousComparableValue = ZERO;
  let currentComparableValue = ZERO;
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let totalMarketValue = ZERO;
  let fxChange = ZERO;
  let comparedForeign = false;
  const classes = new Map<
    AssetClass,
    {
      marketValue: Decimal;
      previous: Decimal;
      change: Decimal;
      comparable: number;
    }
  >();

  const classTotals = (assetClass: AssetClass) => {
    const existing = classes.get(assetClass);

    if (existing) {
      return existing;
    }

    const created = {
      marketValue: ZERO,
      previous: ZERO,
      change: ZERO,
      comparable: 0,
    };
    classes.set(assetClass, created);

    return created;
  };

  /** FX share of a compared position, accumulated into the summary. */
  const fxPart = (
    position: ValuedPosition,
    nativeValue: string,
  ): string | null => {
    if (
      position.currency === input.displayCurrency ||
      position.convertedMarketValue == null
    ) {
      return null;
    }

    const atPreviousRate = toDisplay(
      nativeValue,
      position.currency,
      input.displayCurrency,
      previousRate,
    );
    const part = sub(
      toDecimal(position.convertedMarketValue),
      toDecimal(atPreviousRate),
    );

    comparedForeign = true;
    fxChange = add(fxChange, part);

    return formatDecimal(part, MONEY_PLACES);
  };

  const compare = (
    position: ValuedPosition,
    previousValue: Decimal,
    change: Decimal,
  ) => {
    const totals = classTotals(position.assetClass);

    totals.previous = add(totals.previous, previousValue);
    totals.change = add(totals.change, change);
    totals.comparable += 1;
  };

  const positions = open.map((position): DailyTrackedPosition => {
    if (position.convertedMarketValue != null) {
      totalMarketValue = add(
        totalMarketValue,
        toDecimal(position.convertedMarketValue),
      );
      const totals = classTotals(position.assetClass);
      totals.marketValue = add(
        totals.marketValue,
        toDecimal(position.convertedMarketValue),
      );
    }

    if (isCashPosition(position) && position.convertedMarketValue != null) {
      const nativeValue = position.marketValue ?? position.investedCost;
      const convertedPreviousMarketValue = toDisplay(
        nativeValue,
        position.currency,
        input.displayCurrency,
        previousRate,
      );
      const change = sub(
        toDecimal(position.convertedMarketValue),
        toDecimal(convertedPreviousMarketValue),
      );
      const previousValue = toDecimal(convertedPreviousMarketValue);

      previousComparableValue = add(previousComparableValue, previousValue);
      currentComparableValue = add(
        currentComparableValue,
        toDecimal(position.convertedMarketValue),
      );
      compare(position, previousValue, change);

      return {
        ...position,
        previousClose: position.marketPrice,
        previousCloseAsOf: null,
        convertedPreviousMarketValue,
        dailyChange: formatDecimal(change, MONEY_PLACES),
        dailyChangePercent: ratio(change, previousValue),
        dailyFxChange: fxPart(position, nativeValue),
      };
    }

    const quote = input.quotes.get(position.ticker);

    if (!quote?.previousClose || position.convertedMarketValue == null) {
      return {
        ...position,
        previousClose: null,
        previousCloseAsOf: null,
        convertedPreviousMarketValue: null,
        dailyChange: null,
        dailyChangePercent: null,
        dailyFxChange: null,
      };
    }

    const previousNativeValue = formatDecimal(
      mul(toDecimal(position.quantity), toDecimal(quote.previousClose)),
      MONEY_PLACES,
    );
    const convertedPreviousMarketValue = toDisplay(
      previousNativeValue,
      position.currency,
      input.displayCurrency,
      previousRate,
    );
    const change = sub(
      toDecimal(position.convertedMarketValue),
      toDecimal(convertedPreviousMarketValue),
    );
    const previousValue = toDecimal(convertedPreviousMarketValue);

    previousComparableValue = add(previousComparableValue, previousValue);
    currentComparableValue = add(
      currentComparableValue,
      toDecimal(position.convertedMarketValue),
    );

    compare(position, previousValue, change);

    if (change > ZERO) {
      advancing += 1;
    } else if (change < ZERO) {
      declining += 1;
    } else {
      unchanged += 1;
    }

    return {
      ...position,
      previousClose: quote.previousClose,
      previousCloseAsOf: quote.previousCloseAsOf ?? null,
      convertedPreviousMarketValue,
      dailyChange: formatDecimal(change, MONEY_PLACES),
      dailyChangePercent: ratio(change, previousValue),
      dailyFxChange: fxPart(position, position.marketValue ?? "0"),
    };
  });

  const dailyChange = sub(currentComparableValue, previousComparableValue);
  const comparablePositions = advancing + declining + unchanged;
  const openAssets = open.filter((position) => !isCashPosition(position));
  // Cash alone is comparable only when it is the whole book; next to assets
  // without a previous close it would fake a flat day.
  const hasComparison = comparablePositions > 0 || openAssets.length === 0;

  return {
    positions,
    summary: {
      displayCurrency: input.displayCurrency,
      marketValue: formatDecimal(totalMarketValue, MONEY_PLACES),
      previousComparableValue: formatDecimal(
        previousComparableValue,
        MONEY_PLACES,
      ),
      currentComparableValue: formatDecimal(
        currentComparableValue,
        MONEY_PLACES,
      ),
      dailyChange: hasComparison
        ? formatDecimal(dailyChange, MONEY_PLACES)
        : null,
      dailyChangePercent: hasComparison
        ? ratio(dailyChange, previousComparableValue)
        : null,
      dailyFxChange:
        hasComparison && comparedForeign
          ? formatDecimal(fxChange, MONEY_PLACES)
          : null,
      dailyPriceChange: hasComparison
        ? formatDecimal(
            comparedForeign ? sub(dailyChange, fxChange) : dailyChange,
            MONEY_PLACES,
          )
        : null,
      usdBrlChangePercent:
        input.usdBrlRate && previousRate
          ? ratio(
              sub(toDecimal(input.usdBrlRate), toDecimal(previousRate)),
              toDecimal(previousRate),
            )
          : null,
      byAssetClass: [...classes.entries()]
        .filter(
          ([, totals]) => !isZero(totals.marketValue) || totals.comparable > 0,
        )
        .map(([assetClass, totals]) => ({
          assetClass,
          marketValue: formatDecimal(totals.marketValue, MONEY_PLACES),
          dailyChange:
            totals.comparable > 0
              ? formatDecimal(totals.change, MONEY_PLACES)
              : null,
          dailyChangePercent:
            totals.comparable > 0
              ? ratio(totals.change, totals.previous)
              : null,
          comparablePositions: totals.comparable,
        }))
        .sort((a, b) => Number(b.marketValue) - Number(a.marketValue)),
      advancing,
      declining,
      unchanged,
      comparablePositions,
      openPositions: openAssets.length,
      usdBrlRate: input.usdBrlRate,
      previousUsdBrlRate: previousRate,
    },
  };
}
