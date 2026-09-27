import {
  DEFAULT_SCORE_CONFIG,
  quarterEndDate,
  type ScoreConfig,
  type ValuationSkill,
} from "@portifolio-tracker/shared";

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
  fairValue: string;
};

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

/** Close at the end of a review's quarter, the fair value's reference price. */
export function referencePrice(
  points: readonly ClosePoint[],
  period: string,
): string | null {
  const close = closeOnOrBefore(points, quarterEndDate(period));

  return close === null ? null : ratio(close);
}

export type SkillObservation = {
  period: string;
  ticker: string;
  /** `ln(fairValue / price)` at the quarter end. */
  discount: number;
  /** `ln(price 12 months later / price at the quarter end)`. */
  outcome: number;
};

/**
 * Pairs every fair value with its 12-month outcome. Reviews whose outcome is
 * still in the future are counted as pending, never guessed.
 */
export function skillObservations(
  reviews: readonly FairValueReview[],
  seriesByTicker: ReadonlyMap<string, readonly ClosePoint[]>,
  today: string,
): { observations: SkillObservation[]; pending: number } {
  const observations: SkillObservation[] = [];
  let pending = 0;

  for (const review of reviews) {
    const start = quarterEndDate(review.period);
    const end = shiftMonths(start, -OUTCOME_MONTHS);

    if (end > today) {
      pending += 1;
      continue;
    }

    const points = seriesByTicker.get(review.ticker);
    const fair = Number(review.fairValue);
    if (!points || !(fair > 0)) continue;

    const before = closeOnOrBefore(points, start);
    const after = closeOnOrBefore(points, end);
    if (before === null || after === null) continue;

    observations.push({
      period: review.period,
      ticker: review.ticker,
      discount: Math.log(fair / before),
      outcome: Math.log(after / before),
    });
  }

  return { observations, pending };
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
  pending: number,
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
    pending,
  };
}
