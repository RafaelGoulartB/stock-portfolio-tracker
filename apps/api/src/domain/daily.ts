import type { Currency, ValuedPosition } from "@portifolio-tracker/shared";
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
};

export type DailyTrackingSummary = {
  displayCurrency: Currency;
  marketValue: string;
  previousComparableValue: string;
  currentComparableValue: string;
  dailyChange: string;
  dailyChangePercent: string | null;
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

  const positions = open.map((position): DailyTrackedPosition => {
    if (position.convertedMarketValue != null) {
      totalMarketValue = add(
        totalMarketValue,
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

      if (change > ZERO) {
        advancing += 1;
      } else if (change < ZERO) {
        declining += 1;
      } else {
        unchanged += 1;
      }

      return {
        ...position,
        previousClose: position.marketPrice,
        previousCloseAsOf: null,
        convertedPreviousMarketValue,
        dailyChange: formatDecimal(change, MONEY_PLACES),
        dailyChangePercent: ratio(change, previousValue),
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
    };
  });

  const dailyChange = sub(currentComparableValue, previousComparableValue);

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
      dailyChange: formatDecimal(dailyChange, MONEY_PLACES),
      dailyChangePercent: ratio(dailyChange, previousComparableValue),
      advancing,
      declining,
      unchanged,
      comparablePositions: advancing + declining + unchanged,
      openPositions: open.length,
      usdBrlRate: input.usdBrlRate,
      previousUsdBrlRate: previousRate,
    },
  };
}
