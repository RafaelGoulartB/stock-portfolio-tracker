import {
  DEFAULT_SCORE_CONFIG,
  quarterEndDate,
  type ScoreConfig,
  type ValuationSkill,
} from "@portifolio-tracker/shared";
import { div, formatDecimal, mul, toDecimal } from "../lib/decimal";
import type { SplitEvent } from "./positions";

/**
 * Evidence the score uses to decide how much to trust fair values, and the
 * 12-1 month momentum used as a light tie-breaker.
 *
 * Returns and correlations are dimensionless, so they are computed in
 * floating point and reported at 8 places. No money is derived here.
 */

const RATIO_PLACES = 8;
/** A review needs this many assets in its quarter to rank them against each other. */
const MIN_ASSETS_PER_PERIOD = 3;
const OUTCOME_MONTHS = 12;

/** One daily close, ascending by `asOf`. */
export type ClosePoint = { asOf: string; close: string };

export type FairValueReview = {
  ticker: string;
  period: string;
  /** Per-share fair value in today's share units (see {@link splitAdjustedFairValue}). */
  fairValue: string;
  /** Day the fair value was known, from {@link fairValueAsOf}. */
  asOf: string;
};

/**
 * Day a fair value was known: the later of its quarter end and the review's
 * last edit (`YYYY-MM-DD`, America/Sao_Paulo). Reviews are usually written
 * after the quarter's results, so anchoring on the quarter end alone would
 * credit the investor with price moves they had already seen. Any later
 * edit re-anchors the review: conservative, but never optimistic.
 */
export function fairValueAsOf(period: string, editedOn: string | null): string {
  const quarterEnd = quarterEndDate(period);

  return editedOn !== null && editedOn > quarterEnd ? editedOn : quarterEnd;
}

/**
 * Every stored fair value as the track record and the score read it:
 * anchored on the day it was known and expressed in today's share units.
 */
export function fairValueReviews(
  reviews: readonly {
    ticker: string;
    period: string;
    fairValue: string | null;
    editedOn?: string | null;
  }[],
  splits: readonly SplitEvent[],
): FairValueReview[] {
  return reviews.flatMap((review) => {
    if (review.fairValue === null) return [];

    const asOf = fairValueAsOf(review.period, review.editedOn ?? null);

    return [
      {
        ticker: review.ticker,
        period: review.period,
        fairValue: splitAdjustedFairValue(
          review.fairValue,
          asOf,
          splits.filter((split) => split.ticker === review.ticker),
        ),
        asOf,
      },
    ];
  });
}

/**
 * A per-share fair value in today's share units. Price histories are split
 * adjusted, so a fair value written before a split must be scaled by every
 * split effective after it (`2:1` halves it) to stay comparable.
 */
export function splitAdjustedFairValue(
  fairValue: string,
  asOf: string,
  splits: readonly SplitEvent[],
): string {
  let value = toDecimal(fairValue);

  for (const split of splits) {
    if (split.effectiveAt <= asOf) continue;
    value = div(
      mul(value, toDecimal(split.fromQuantity)),
      toDecimal(split.toQuantity),
    );
  }

  return formatDecimal(value, RATIO_PLACES);
}

function ratio(value: number): string {
  return value.toFixed(RATIO_PLACES);
}

/** Calendar day `months` before `day`, clamped to the month's last day. */
export function shiftMonths(day: string, months: number): string {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();

  target.setUTCDate(Math.min(date, lastDay));

  return target.toISOString().slice(0, 10);
}

/**
 * Last close at or before `day`, or `null` when the series starts later.
 * Weekends and holidays resolve to the previous trading day.
 */
export function closeOnOrBefore(
  points: readonly ClosePoint[],
  day: string,
): number | null {
  let found: number | null = null;

  for (const point of points) {
    if (point.asOf > day) break;
    const close = Number(point.close);
    if (close > 0) found = close;
  }

  return found;
}

/**
 * 12-1 month momentum: `ln(close a month ago / close a year ago)`. Skipping
 * the latest month avoids its short-term reversal. `null` when the series
 * does not reach back a full year.
 */
export function momentum12to1(
  points: readonly ClosePoint[],
  today: string,
): string | null {
  const recent = closeOnOrBefore(points, shiftMonths(today, 1));
  const yearAgo = closeOnOrBefore(points, shiftMonths(today, OUTCOME_MONTHS));

  if (recent === null || yearAgo === null) return null;

  return ratio(Math.log(recent / yearAgo));
}

/** Close on the day a fair value was known, its reference price. */
export function referencePrice(
  points: readonly ClosePoint[],
  asOf: string,
): string | null {
  const close = closeOnOrBefore(points, asOf);

  return close === null ? null : ratio(close);
}

export type SkillObservation = {
  period: string;
  ticker: string;
  /** `ln(fairValue / price)` on the day the fair value was known. */
  discount: number;
  /** `ln(price 12 months later / price on that day)`. */
  outcome: number;
};

/**
 * Pairs every fair value with its 12-month outcome, starting on the day the
 * fair value was known. Reviews whose outcome is still in the future are
 * pending, never guessed; due reviews without prices are counted as missing
 * so a partial track record is visible instead of silently smaller.
 */
export function skillObservations(
  reviews: readonly FairValueReview[],
  seriesByTicker: ReadonlyMap<string, readonly ClosePoint[]>,
  today: string,
): { observations: SkillObservation[]; pending: number; missing: number } {
  const observations: SkillObservation[] = [];
  let pending = 0;
  let missing = 0;

  for (const review of reviews) {
    const start = review.asOf;
    const end = shiftMonths(start, -OUTCOME_MONTHS);

    if (end > today) {
      pending += 1;
      continue;
    }

    const points = seriesByTicker.get(review.ticker);
    const fair = Number(review.fairValue);
    if (!(fair > 0)) continue;

    const before = points ? closeOnOrBefore(points, start) : null;
    const after = points ? closeOnOrBefore(points, end) : null;
    if (before === null || after === null) {
      missing += 1;
      continue;
    }

    observations.push({
      period: review.period,
      ticker: review.ticker,
      discount: Math.log(fair / before),
      outcome: Math.log(after / before),
    });
  }

  return { observations, pending, missing };
}

/**
 * Pooled cross-sectional information coefficient of the investor's fair
 * values, shrunk toward the prior:
 *
 * - within each review quarter, discounts and outcomes are demeaned, so a
 *   market-wide rally never counts as valuation skill;
 * - quarters with fewer than three assets are skipped (nothing to rank);
 * - `shrunk = (pairs × IC + icPriorPairs × icPrior) / (pairs + icPriorPairs)`;
 * - `confidence = clamp(shrunk ÷ icReference, 0, 1)` and the valuation
 *   exponent is `valuationSensitivity × confidence`.
 *
 * A track record that shows no skill drives the strength to zero, which
 * turns the score into plain gap-filling rather than betting on noise.
 */
export function valuationSkill(
  observations: readonly SkillObservation[],
  counts: { pending: number; missing?: number },
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): ValuationSkill {
  const byPeriod = new Map<string, SkillObservation[]>();

  for (const observation of observations) {
    const list = byPeriod.get(observation.period) ?? [];
    list.push(observation);
    byPeriod.set(observation.period, list);
  }

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  let pairs = 0;
  let periods = 0;

  for (const list of byPeriod.values()) {
    if (list.length < MIN_ASSETS_PER_PERIOD) continue;

    const meanX =
      list.reduce((sum, item) => sum + item.discount, 0) / list.length;
    const meanY =
      list.reduce((sum, item) => sum + item.outcome, 0) / list.length;

    for (const item of list) {
      const x = item.discount - meanX;
      const y = item.outcome - meanY;
      sxy += x * y;
      sxx += x * x;
      syy += y * y;
    }

    pairs += list.length;
    periods += 1;
  }

  const ic =
    pairs > 0 && sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  const prior = Number(config.icPrior);
  const priorPairs = config.icPriorPairs;
  const shrunk =
    ic === null || pairs + priorPairs === 0
      ? prior
      : (pairs * ic + priorPairs * prior) / (pairs + priorPairs);
  const confidence = Math.min(
    1,
    Math.max(0, shrunk / Number(config.icReference)),
  );

  return {
    ic: ic === null ? null : ratio(ic),
    shrunkIc: ratio(shrunk),
    confidence: ratio(confidence),
    strength: ratio(Number(config.valuationSensitivity) * confidence),
    pairs: ic === null ? 0 : pairs,
    periods: ic === null ? 0 : periods,
    pending: counts.pending,
    missing: counts.missing ?? 0,
  };
}
