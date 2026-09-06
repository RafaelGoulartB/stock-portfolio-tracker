import {
  parseQuarterKey,
  quarterKey,
  type ReviewPeriod,
} from "@portifolio-tracker/shared";

export type Quarter = {
  /** `2026Q1`, the same key the API stores. */
  key: ReviewPeriod;
  year: number;
  /** `1`–`4`. */
  quarter: number;
};

export function toQuarter(key: string): Quarter {
  const { year, quarter } = parseQuarterKey(key);

  return { key: quarterKey(year, quarter), year, quarter };
}

/** Calendar quarter of `now`, in the browser timezone. */
export function currentQuarter(now: Date = new Date()): Quarter {
  const quarter = Math.floor(now.getMonth() / 3) + 1;

  return {
    key: quarterKey(now.getFullYear(), quarter),
    year: now.getFullYear(),
    quarter,
  };
}

/** Moves a quarter by `by` quarters; negative goes back in time. */
export function shiftQuarter(quarter: Quarter, by: number): Quarter {
  const index = quarter.year * 4 + (quarter.quarter - 1) + by;
  const year = Math.floor(index / 4);

  return {
    key: quarterKey(year, (index % 4) + 1),
    year,
    quarter: (index % 4) + 1,
  };
}

/** `count` quarters ending at `end`, oldest first. */
export function quarterWindow(end: Quarter, count: number): Quarter[] {
  return Array.from({ length: count }, (_unused, index) =>
    shiftQuarter(end, index - (count - 1)),
  );
}

/**
 * Short quarter label, e.g. `Q1 26`. Kept locale-independent: `Q1` is how
 * the UI names a quarter everywhere, and only the two-digit year varies.
 */
export function formatQuarterLabel(quarter: Quarter): string {
  return `Q${quarter.quarter} ${String(quarter.year).slice(-2)}`;
}

/** Full quarter label for tooltips and headings, e.g. `Q1 2026`. */
export function formatQuarterTitle(quarter: Quarter): string {
  return `Q${quarter.quarter} ${quarter.year}`;
}
