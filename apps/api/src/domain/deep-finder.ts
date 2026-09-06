import type { DeepFinderWindow } from "@portifolio-tracker/shared";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseUtcDay(day: string): Date {
  const match = ISO_DAY.exec(day);

  if (!match) {
    throw new Error(`Not an ISO day: ${day}`);
  }

  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function formatUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` calendar day by a signed number of days. */
export function shiftIsoDate(day: string, days: number): string {
  const date = parseUtcDay(day);
  date.setUTCDate(date.getUTCDate() + days);

  return formatUtcDay(date);
}

/** Shift a `YYYY-MM-DD` calendar day by a signed number of months. */
export function shiftIsoMonth(day: string, months: number): string {
  const date = parseUtcDay(day);
  date.setUTCMonth(date.getUTCMonth() + months);

  return formatUtcDay(date);
}

/**
 * Inclusive start of a Deep Finder window. `cost` has no start day because
 * it compares the live quote to the moving average, not to a past close.
 *
 * YTD uses 31 Dec of the previous year so the first close of the new year
 * is measured against last year's last session.
 */
export function windowStartDay(
  window: DeepFinderWindow,
  today: string,
): string | null {
  switch (window) {
    case "cost":
      return null;
    case "1d":
      return shiftIsoDate(today, -1);
    case "1w":
      return shiftIsoDate(today, -7);
    case "1m":
      return shiftIsoMonth(today, -1);
    case "3m":
      return shiftIsoMonth(today, -3);
    case "1y":
      return shiftIsoMonth(today, -12);
    case "ytd": {
      const year = Number(today.slice(0, 4));

      return `${year - 1}-12-31`;
    }
  }
}

/** Extra calendar days before the window start so a weekend still has a close. */
export function seriesLookbackStart(start: string): string {
  return shiftIsoDate(start, -10);
}
