import {
  DEFAULT_SCORE_CONFIG,
  type GradeBand,
  parseQuarterKey,
  type ScoreBreakdown,
  type ScoreConfig,
  type ScoreRuleId,
} from "@portifolio-tracker/shared";
import {
  add,
  type Decimal,
  div,
  formatDecimal,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../lib/decimal";

/**
 * Contribution score engine, v3.
 *
 * The score answers one question: *how much does this asset deserve the next
 * contribution?* It is built in three independent steps:
 *
 * 1. **Where to go** — the user's target, tilted by valuation and then by a
 *    light momentum tie-breaker. The valuation tilt's strength is learned
 *    from the investor's own track record (see `valuation-skill.ts`) and is
 *    renormalized only among assets that have a fair value; momentum is
 *    renormalized across the book. Tilts therefore move weight between
 *    assets instead of inflating every target at once.
 * 2. **How much is missing** — the relative gap `1 - weight / tiltedTarget`,
 *    so 2% → 0% (all of the target missing) outranks 10% → 8%.
 * 3. **How urgently** — a priority from the evidence-weighted grade and the
 *    cooldown ramp. Priority changes the order and speed of filling, never
 *    the destination.
 *
 * `value = max(relativeGap, 0) × priority`; negative values are trim
 * signals. The contribution planner solves the actual split from the same
 * tilted targets, priorities and ceilings (see `contribution-plan.ts`).
 *
 * Every threshold is a field of {@link ScoreConfig}; every decision is one
 * entry of {@link SCORE_RULES}, evaluated in order, first match wins.
 */

const ONE = toDecimal("1");
/** Scores and weights share the ratio precision used across the domain. */
const WEIGHT_PLACES = 8;
const GRADE_PLACES = 2;
const MILLIS_PER_DAY = 86_400_000;

/**
 * Grade evidence for one asset, from {@link gradeSignal}. Computed once per
 * ticker from its reviews and the reference day.
 */
export type GradeSignal = {
  /** Recency-weighted average grade, `null` when never graded. */
  average: string | null;
  /** Graded quarters read inside the window. */
  quarters: number;
  /** Sum of recency weights: how many "fresh quarters" of evidence exist. */
  evidence: string;
  /** Interpolated multiplier shrunk toward the ungraded one by evidence. */
  multiplier: string;
};

export type ScoreInput = {
  /** Target share of the portfolio, `0`–`1`. `null` when not set yet. */
  targetWeight: string | null;
  /** Current share of the portfolio, `0`–`1`. */
  currentWeight: string;
  /**
   * True for a held position that no live or manual price could value. Its
   * `currentWeight` is then a placeholder `0`, not a measured weight.
   */
  quoteMissing?: boolean;
  /** Newest fair value, native currency. `null` disables the tilt. */
  fairValue: string | null;
  /** Native market price. `null` disables the tilt. */
  marketPrice: string | null;
  /** Review period the fair value came from, e.g. `2026Q2`. */
  fairValuePeriod: string | null;
  /**
   * Extra cost of buying, as a fraction of price (FX spread and IOF for a
   * USD asset bought with BRL). A cheap asset must clear it to tilt up.
   */
  buyCost?: string | null;
  grade: GradeSignal;
  /** Date of the last buy, `YYYY-MM-DD`. `null` when never bought. */
  lastContributionAt: string | null;
  /** Reference day for ages and the cooldown, `YYYY-MM-DD`. */
  today: string;
  /**
   * `false` for the residual cash row: its target is whatever the others
   * leave, so it is never tilted and never renormalizes the rest.
   */
  tiltable?: boolean;
  /** 12-1 month log return, `null` when no year of prices is available. */
  momentum?: string | null;
  /** Close at the fair value's quarter end, for the review suggestion. */
  referencePrice?: string | null;
};

/** Book-level inputs that are not a property of any single asset. */
export type ScoreOptions = {
  /**
   * Effective valuation exponent from the investor's track record. Omitted
   * means the prior: `valuationSensitivity × min(1, icPrior ÷ icReference)`.
   */
  valuationStrength?: string;
};

/** Everything a rule can read, computed once per asset. */
export type ScoreContext = {
  target: Decimal | null;
  weight: Decimal;
  quoteMissing: boolean;
  /** Pre-normalization tilt, `1` without a valuation. `< 1` means expensive. */
  rawTilt: Decimal;
  tiltedTarget: Decimal | null;
  /** Floor for trims and sales; see `ScoreBreakdown.trimTarget`. */
  trimTarget: Decimal | null;
  tilt: Decimal | null;
  valuationTilt: Decimal | null;
  momentumTilt: Decimal | null;
  momentumZ: Decimal | null;
  priceSinceFairValue: Decimal | null;
  reviewSuggested: boolean;
  valuationSignal: Decimal | null;
  valuationConfidence: Decimal | null;
  gap: Decimal | null;
  relativeGap: Decimal | null;
  gradeMultiplier: Decimal;
  recencyMultiplier: Decimal;
  priority: Decimal;
  maxWeight: Decimal | null;
  daysSinceContribution: number | null;
  cooldownUntil: string | null;
};

export type ScoreRule = {
  id: ScoreRuleId;
  /** Zeroed on purpose, as opposed to simply having no gap left. */
  blocking?: boolean;
  matches(context: ScoreContext, config: ScoreConfig): boolean;
  score(context: ScoreContext, config: ScoreConfig): Decimal;
};

function toDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);

  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** Whole days between two `YYYY-MM-DD` dates, negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round((toDay(to) - toDay(from)) / MILLIS_PER_DAY);
}

function addDays(value: string, days: number): string {
  return new Date(toDay(value) + days * MILLIS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * Dimensionless curves (logarithms, half-lives) are evaluated in floating
 * point and brought back at the domain's 8-place ratio precision. They only
 * shape weights and priorities; no money is computed here.
 */
function fromRatio(value: number): Decimal {
  return toDecimal(value.toFixed(WEIGHT_PLACES));
}

function toRatio(value: Decimal): number {
  return Number(formatDecimal(value, WEIGHT_PLACES));
}

function clamp(value: Decimal, low: Decimal, high: Decimal): Decimal {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

function min(a: Decimal, b: Decimal): Decimal {
  return a < b ? a : b;
}

/**
 * Quarters between a review period and the last *completed* quarter of
 * `today`. A review of the quarter that just closed is age `0`: reviews are
 * written after results, so the freshest possible review is never stale.
 */
export function quarterAge(period: string, today: string): number {
  const { year, quarter } = parseQuarterKey(period);
  const [todayYear = 1970, todayMonth = 1] = today.split("-").map(Number);
  const current = todayYear * 4 + Math.floor((todayMonth - 1) / 3);
  const reviewed = year * 4 + quarter - 1;

  return Math.max(0, current - reviewed - 1);
}

/** `0.5 ^ (age / halfLife)`: the weight of evidence `age` quarters old. */
export function halfLifeWeight(age: number, halfLife: number): Decimal {
  return fromRatio(0.5 ** (age / halfLife));
}

/**
 * Piecewise-linear grade curve through the configured knots. Knots are
 * sorted here so a stored policy with any order still reads correctly.
 */
export function interpolateGrade(
  grade: Decimal,
  bands: readonly GradeBand[],
): Decimal {
  const knots = bands
    .map((band) => ({
      grade: toDecimal(band.minGrade),
      multiplier: toDecimal(band.multiplier),
    }))
    .sort((a, b) => (a.grade < b.grade ? -1 : a.grade > b.grade ? 1 : 0));
  const first = knots[0];

  if (!first) {
    throw new Error("The grade curve has no knots configured");
  }

  if (grade <= first.grade) {
    return first.multiplier;
  }

  for (let index = 1; index < knots.length; index += 1) {
    const low = knots[index - 1];
    const high = knots[index];

    if (low && high && grade <= high.grade) {
      const position = div(sub(grade, low.grade), sub(high.grade, low.grade));

      return add(
        low.multiplier,
        mul(position, sub(high.multiplier, low.multiplier)),
      );
    }
  }

  return knots[knots.length - 1]?.multiplier ?? first.multiplier;
}

/**
 * Grade evidence from quarterly reviews.
 *
 * Only graded reviews count, newest `gradeWindowQuarters` first. Each grade
 * weighs `0.5 ^ (age / gradeHalfLifeQuarters)`, so the average leans on
 * recent quarters and the *evidence* (sum of weights) fades as reviews age.
 * The multiplier is then shrunk toward the ungraded multiplier as a prior
 * worth `gradePriorQuarters` fresh quarters:
 *
 * `(evidence × curve(average) + prior × ungraded) / (evidence + prior)`
 *
 * An ungraded asset therefore sits exactly at the ungraded multiplier, and
 * grading it moves the multiplier gradually instead of all at once.
 */
export function gradeSignal(
  reviews: readonly { period: string; grade: string | null }[],
  today: string,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): GradeSignal {
  const ungraded = toDecimal(config.ungradedMultiplier);
  const graded = reviews
    .filter(
      (review): review is { period: string; grade: string } =>
        review.grade !== null,
    )
    // Period keys (`2026Q1`) sort chronologically as plain strings.
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, config.gradeWindowQuarters);

  if (graded.length === 0) {
    return {
      average: null,
      quarters: 0,
      evidence: formatDecimal(ZERO, WEIGHT_PLACES),
      multiplier: formatDecimal(ungraded, WEIGHT_PLACES),
    };
  }

  let weighted = ZERO;
  let evidence = ZERO;

  for (const review of graded) {
    const weight = halfLifeWeight(
      quarterAge(review.period, today),
      config.gradeHalfLifeQuarters,
    );

    weighted = add(weighted, mul(weight, toDecimal(review.grade)));
    evidence = add(evidence, weight);
  }

  const average = div(weighted, evidence);
  const curve = interpolateGrade(average, config.gradeBands);
  const prior = toDecimal(config.gradePriorQuarters);
  const multiplier = div(
    add(mul(evidence, curve), mul(prior, ungraded)),
    add(evidence, prior),
  );

  return {
    average: formatDecimal(average, GRADE_PLACES),
    quarters: graded.length,
    evidence: formatDecimal(evidence, WEIGHT_PLACES),
    multiplier: formatDecimal(multiplier, WEIGHT_PLACES),
  };
}

/**
 * Valuation tilt for one asset, before renormalization.
 *
 * 1. `u = ln(fairValue / price)` — symmetric: half and double the fair value
 *    are equally far from it, unlike the bounded `(FV - P) / FV` discount.
 * 2. Soft-threshold by `valuationDeadZone` (`0` by default: shrinking the
 *    whole signal beats cutting a band out of it).
 * 3. A positive signal must also clear the buy cost (FX spread and IOF).
 * 4. Confidence `c = min(grade multiplier, 1) × 0.5 ^ (age / half-life)`:
 *    a stale fair value or a weak thesis pulls the tilt back toward `1`.
 * 5. `tilt = clamp(exp(strength × c × signal), tiltMin, tiltMax)`, where
 *    `strength` is learned from the track record (see `valuation-skill.ts`).
 *
 * This is a simplified Black–Litterman blend: the target is the prior, the
 * fair value is the view, and confidence decides how far the view moves it.
 */
export function valuationTilt(
  input: Pick<
    ScoreInput,
    "fairValue" | "marketPrice" | "fairValuePeriod" | "buyCost" | "today"
  >,
  gradeMultiplier: Decimal,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
  strength: Decimal = defaultValuationStrength(config),
): { signal: Decimal; confidence: Decimal; tilt: Decimal } | null {
  if (input.fairValue === null || input.marketPrice === null) {
    return null;
  }

  const fair = toDecimal(input.fairValue);
  const price = toDecimal(input.marketPrice);

  if (fair <= ZERO || price <= ZERO) {
    return null;
  }

  const mispricing = Math.log(toRatio(fair) / toRatio(price));
  const deadZone = toRatio(toDecimal(config.valuationDeadZone));
  let signal =
    Math.sign(mispricing) * Math.max(0, Math.abs(mispricing) - deadZone);

  if (signal > 0 && input.buyCost != null) {
    const cost = Math.log(1 + toRatio(toDecimal(input.buyCost)));
    signal = Math.max(0, signal - cost);
  }

  const age =
    input.fairValuePeriod === null
      ? 0
      : quarterAge(input.fairValuePeriod, input.today);
  const confidence = mul(
    min(gradeMultiplier, ONE),
    halfLifeWeight(age, config.fairValueHalfLifeQuarters),
  );
  const exponent = toRatio(strength) * toRatio(confidence) * signal;
  const tiltMin = toDecimal(config.tiltMin);
  const tiltMax = toDecimal(config.tiltMax);
  // Clamp in float space first so an extreme exponent cannot overflow.
  const tilt = clamp(
    fromRatio(
      Math.min(
        Math.max(Math.exp(exponent), toRatio(tiltMin)),
        toRatio(tiltMax),
      ),
    ),
    tiltMin,
    tiltMax,
  );

  return { signal: fromRatio(signal), confidence, tilt };
}

/**
 * Valuation exponent before any track record exists: the configured
 * sensitivity scaled by how the prior IC compares with the reference IC.
 */
export function defaultValuationStrength(
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): Decimal {
  const confidence = clamp(
    div(toDecimal(config.icPrior), toDecimal(config.icReference)),
    ZERO,
    ONE,
  );

  return mul(toDecimal(config.valuationSensitivity), confidence);
}

function recencyMultiplier(
  daysSinceContribution: number | null,
  config: ScoreConfig,
): Decimal {
  if (
    daysSinceContribution === null ||
    config.cooldownDays <= 0 ||
    daysSinceContribution >= config.cooldownDays
  ) {
    return ONE;
  }

  const floor = toDecimal(config.cooldownFloor);
  const elapsed = Math.max(0, daysSinceContribution) / config.cooldownDays;

  return add(floor, mul(sub(ONE, floor), fromRatio(elapsed)));
}

/**
 * Highest weight a contribution may take the asset to. A normally-sized
 * target stops at the absolute cap; every target stops at
 * `target × overweightBlockFactor`, which also bounds a generous tilt.
 */
function maxWeightFor(target: Decimal, config: ScoreConfig): Decimal {
  const cap = toDecimal(config.absoluteWeightCap);
  const relative = mul(target, toDecimal(config.overweightBlockFactor));

  return target <= cap ? min(cap, relative) : relative;
}

/**
 * The rule ladder, in priority order. Keep it declarative: a rule reads the
 * context and the config, and never reaches for data of its own.
 */
export const SCORE_RULES: readonly ScoreRule[] = [
  {
    id: "no-target",
    matches: (context) => context.target === null,
    score: () => ZERO,
  },
  {
    // An unvalued holding reads as a 0% weight, which would look like the
    // biggest gap in the book. Missing data must never rank for capital.
    id: "no-quote",
    blocking: true,
    matches: (context) => context.quoteMissing,
    score: () => ZERO,
  },
  {
    // Expensive and past the 5/25-style tolerance band around the trim
    // target: suggest giving weight back.
    id: "trim-overweight",
    matches: (context, config) => {
      if (context.trimTarget === null || context.rawTilt >= ONE) {
        return false;
      }

      const band = min(
        toDecimal(config.trimAbsoluteBand),
        mul(context.trimTarget, toDecimal(config.trimRelativeBand)),
      );

      return sub(context.weight, context.trimTarget) > band;
    },
    score: (context) => context.relativeGap ?? ZERO,
  },
  {
    id: "weight-cap",
    blocking: true,
    matches: (context, config) =>
      context.target !== null &&
      context.target <= toDecimal(config.absoluteWeightCap) &&
      context.weight > toDecimal(config.absoluteWeightCap),
    score: () => ZERO,
  },
  {
    id: "target-overweight",
    blocking: true,
    matches: (context, config) =>
      context.target !== null &&
      context.weight >
        mul(context.target, toDecimal(config.overweightBlockFactor)),
    score: () => ZERO,
  },
  {
    // Still a candidate: the ramp lowers priority instead of blocking, so a
    // tiny buy no longer freezes an asset and a large gap can still win.
    id: "cooldown",
    matches: (context) =>
      context.cooldownUntil !== null &&
      context.relativeGap !== null &&
      context.relativeGap > ZERO,
    score: (context) => mul(context.relativeGap ?? ZERO, context.priority),
  },
  {
    id: "gap-weighted",
    matches: () => true,
    score: (context) =>
      mul(
        context.relativeGap !== null && context.relativeGap > ZERO
          ? context.relativeGap
          : ZERO,
        context.priority,
      ),
  },
];

type Prepared = {
  input: ScoreInput;
  target: Decimal | null;
  valuation: ReturnType<typeof valuationTilt>;
  gradeMultiplier: Decimal;
};

function prepare(
  input: ScoreInput,
  config: ScoreConfig,
  strength: Decimal,
): Prepared {
  const gradeMultiplier = toDecimal(input.grade.multiplier);
  const tiltable = input.tiltable !== false;

  return {
    input,
    target: input.targetWeight === null ? null : toDecimal(input.targetWeight),
    valuation: tiltable
      ? valuationTilt(input, gradeMultiplier, config, strength)
      : null,
    gradeMultiplier,
  };
}

/** `numerator / denominator` rounded half away from zero, raw bigints. */
function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  const quotient = top / bottom;
  const rounded = (top % bottom) * 2n >= bottom ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/** How one asset's target is scaled; `null` fields mean "not applicable". */
type Scaling = {
  tiltedTarget: Decimal | null;
  tilt: Decimal | null;
  valuationTilt: Decimal | null;
  momentumTilt: Decimal | null;
  momentumZ: Decimal | null;
};

/**
 * Capped cross-sectional z-scores of the 12-1 month momentum, over the
 * tiltable, targeted, priced assets that have one. Fewer than two such
 * assets, or no dispersion, means no momentum signal at all.
 */
function momentumScores(
  prepared: readonly Prepared[],
  config: ScoreConfig,
): (Decimal | null)[] {
  const eligible = prepared.map((entry) =>
    entry.target !== null &&
    entry.input.tiltable !== false &&
    entry.input.quoteMissing !== true &&
    entry.input.momentum != null
      ? toRatio(toDecimal(entry.input.momentum))
      : null,
  );
  const values = eligible.filter((value): value is number => value !== null);

  if (values.length < 2) return eligible.map(() => null);

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );

  if (!(spread > 0)) return eligible.map(() => null);

  const cap = toRatio(toDecimal(config.momentumZCap));

  return eligible.map((value) =>
    value === null
      ? null
      : fromRatio(Math.min(cap, Math.max(-cap, (value - mean) / spread))),
  );
}

/**
 * Two renormalizations, each keeping the sum of the targets it touches.
 * Sums keep the full `bigint` product (16 places) and divide last, so a
 * book whose tilts cancel returns its targets exactly.
 *
 * 1. Valuation: `t1 = t × vTilt × Σt / Σ(t × vTilt)` only among assets with
 *    a fair value; the weight a costly asset gives up goes to other valued
 *    assets, never away from ETFs or anything without a valuation.
 * 2. Momentum: `t2 = t1 × m × Σt1 / Σ(t1 × m)` across the whole tiltable
 *    book, with `m = exp(momentumWeight × z)`.
 */
function bookScaling(
  prepared: readonly Prepared[],
  config: ScoreConfig,
): Scaling[] {
  const inBook = (entry: Prepared) =>
    entry.target !== null && entry.input.tiltable !== false;
  const valued = (entry: Prepared) => inBook(entry) && entry.valuation !== null;

  let valuedTargets = ZERO;
  let valuedProducts = 0n;
  for (const entry of prepared) {
    if (!valued(entry) || entry.target === null || !entry.valuation) continue;
    valuedTargets = add(valuedTargets, entry.target);
    valuedProducts += entry.target * entry.valuation.tilt;
  }

  const valuationRatio = (entry: Prepared): Decimal =>
    valued(entry) && entry.valuation && valuedProducts > 0n
      ? roundedQuotient(
          ONE * entry.valuation.tilt * valuedTargets,
          valuedProducts,
        )
      : ONE;
  const firstStep = prepared.map((entry) =>
    entry.target === null
      ? null
      : valued(entry) && entry.valuation && valuedProducts > 0n
        ? roundedQuotient(
            entry.target * entry.valuation.tilt * valuedTargets,
            valuedProducts,
          )
        : entry.target,
  );

  const zScores = momentumScores(prepared, config);
  const weight = toRatio(toDecimal(config.momentumWeight));
  // Bounded in float space so a stored policy can never overflow decimals.
  const factors = zScores.map((z) =>
    z === null
      ? ONE
      : fromRatio(Math.exp(Math.min(20, Math.max(-20, weight * toRatio(z))))),
  );

  let bookTargets = ZERO;
  let bookProducts = 0n;
  prepared.forEach((entry, index) => {
    const step = firstStep[index];
    if (!inBook(entry) || step == null) return;
    bookTargets = add(bookTargets, step);
    bookProducts += step * (factors[index] ?? ONE);
  });

  return prepared.map((entry, index): Scaling => {
    const step = firstStep[index] ?? null;

    if (entry.target === null || step === null) {
      return {
        tiltedTarget: null,
        tilt: null,
        valuationTilt: null,
        momentumTilt: null,
        momentumZ: null,
      };
    }

    if (!inBook(entry)) {
      return {
        tiltedTarget: entry.target,
        tilt: ONE,
        valuationTilt: ONE,
        momentumTilt: ONE,
        momentumZ: null,
      };
    }

    const factor = factors[index] ?? ONE;
    const momentumTilt =
      bookProducts > 0n
        ? roundedQuotient(ONE * factor * bookTargets, bookProducts)
        : ONE;
    const tiltedTarget =
      bookProducts > 0n
        ? roundedQuotient(step * factor * bookTargets, bookProducts)
        : step;
    const valuation = valuationRatio(entry);

    return {
      tiltedTarget,
      tilt:
        entry.target > ZERO
          ? div(tiltedTarget, entry.target)
          : mul(valuation, momentumTilt),
      valuationTilt: valuation,
      momentumTilt,
      momentumZ: zScores[index] ?? null,
    };
  });
}

/** A single asset, with its raw valuation tilt and no book to share weight with. */
function soloScaling(entry: Prepared): Scaling {
  if (entry.target === null) {
    return {
      tiltedTarget: null,
      tilt: null,
      valuationTilt: null,
      momentumTilt: null,
      momentumZ: null,
    };
  }

  const valuation =
    entry.input.tiltable !== false ? (entry.valuation?.tilt ?? ONE) : ONE;

  return {
    tiltedTarget: mul(entry.target, valuation),
    tilt: valuation,
    valuationTilt: valuation,
    momentumTilt: ONE,
    momentumZ: null,
  };
}

function contextFor(
  entry: Prepared,
  scaling: Scaling,
  config: ScoreConfig,
): ScoreContext {
  const { input, target, valuation, gradeMultiplier } = entry;
  const weight = toDecimal(input.currentWeight);
  const rawTilt = valuation?.tilt ?? ONE;
  const { tiltedTarget } = scaling;
  // An expensive asset gives back weight down to its own valuation tilt,
  // never further because some other asset happens to be cheap.
  const ownTarget = target === null ? null : mul(target, min(rawTilt, ONE));
  const trimTarget =
    tiltedTarget === null || ownTarget === null
      ? tiltedTarget
      : tiltedTarget > ownTarget
        ? tiltedTarget
        : ownTarget;
  const gap = tiltedTarget === null ? null : sub(tiltedTarget, weight);
  const relativeGap =
    tiltedTarget === null || gap === null
      ? null
      : tiltedTarget > ZERO
        ? div(gap, tiltedTarget)
        : // A zero target with anything held is fully surplus.
          weight > ZERO
          ? toDecimal("-1")
          : ZERO;
  const daysSinceContribution =
    input.lastContributionAt === null
      ? null
      : daysBetween(input.lastContributionAt, input.today);
  const inCooldown =
    daysSinceContribution !== null &&
    daysSinceContribution < config.cooldownDays;
  const recency = recencyMultiplier(daysSinceContribution, config);
  const priceSinceFairValue =
    input.fairValue !== null &&
    input.marketPrice !== null &&
    input.referencePrice != null &&
    toDecimal(input.referencePrice) > ZERO
      ? sub(
          div(toDecimal(input.marketPrice), toDecimal(input.referencePrice)),
          ONE,
        )
      : null;
  const drift = toDecimal(config.reviewDrift);

  return {
    target,
    weight,
    quoteMissing: input.quoteMissing === true,
    rawTilt,
    tiltedTarget,
    trimTarget,
    tilt: scaling.tilt,
    valuationTilt: scaling.valuationTilt,
    momentumTilt: scaling.momentumTilt,
    momentumZ: scaling.momentumZ,
    priceSinceFairValue,
    reviewSuggested:
      priceSinceFairValue !== null &&
      (priceSinceFairValue >= drift || priceSinceFairValue <= -drift),
    valuationSignal: valuation?.signal ?? null,
    valuationConfidence: valuation?.confidence ?? null,
    gap,
    relativeGap,
    gradeMultiplier,
    recencyMultiplier: recency,
    priority: mul(gradeMultiplier, recency),
    maxWeight: target === null ? null : maxWeightFor(target, config),
    daysSinceContribution,
    cooldownUntil:
      inCooldown && input.lastContributionAt !== null
        ? addDays(input.lastContributionAt, config.cooldownDays)
        : null,
  };
}

function breakdown(context: ScoreContext, config: ScoreConfig): ScoreBreakdown {
  const rule =
    SCORE_RULES.find((candidate) => candidate.matches(context, config)) ??
    SCORE_RULES[SCORE_RULES.length - 1];

  if (!rule) {
    throw new Error("The score engine has no rules configured");
  }

  const ratio = (value: Decimal | null) =>
    value === null ? null : formatDecimal(value, WEIGHT_PLACES);

  return {
    value: formatDecimal(rule.score(context, config), WEIGHT_PLACES),
    ruleId: rule.id,
    tiltedTarget: ratio(context.tiltedTarget),
    trimTarget: ratio(context.trimTarget),
    tilt: ratio(context.tilt),
    valuationTilt: ratio(context.valuationTilt),
    momentumTilt: ratio(context.momentumTilt),
    momentumZ: ratio(context.momentumZ),
    valuationSignal: ratio(context.valuationSignal),
    valuationConfidence: ratio(context.valuationConfidence),
    gap: ratio(context.gap),
    relativeGap: ratio(context.relativeGap),
    gradeMultiplier: formatDecimal(context.gradeMultiplier, WEIGHT_PLACES),
    recencyMultiplier: formatDecimal(context.recencyMultiplier, WEIGHT_PLACES),
    priority: formatDecimal(context.priority, WEIGHT_PLACES),
    maxWeight: ratio(context.maxWeight),
    blocked: rule.blocking === true,
    daysSinceContribution: context.daysSinceContribution,
    cooldownUntil: context.cooldownUntil,
    priceSinceFairValue: ratio(context.priceSinceFairValue),
    reviewSuggested: context.reviewSuggested,
  };
}

/**
 * Scores a whole book at once. Tilted targets depend on every other
 * asset's tilt through renormalization, so scoring one asset in isolation
 * is only meaningful for a single-asset book (see {@link scoreAsset}).
 */
export function scoreAssets(
  inputs: readonly ScoreInput[],
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
  options: ScoreOptions = {},
): ScoreBreakdown[] {
  const strength =
    options.valuationStrength === undefined
      ? defaultValuationStrength(config)
      : toDecimal(options.valuationStrength);
  const prepared = inputs.map((input) => prepare(input, config, strength));
  const scalings = bookScaling(prepared, config);

  return prepared.map((entry, index) => {
    const scaling = scalings[index];

    if (!scaling) {
      throw new Error("Missing target scaling");
    }

    return breakdown(contextFor(entry, scaling, config), config);
  });
}

/** One asset scored without renormalization against a book. */
export function scoreAsset(
  input: ScoreInput,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
  options: ScoreOptions = {},
): ScoreBreakdown {
  const strength =
    options.valuationStrength === undefined
      ? defaultValuationStrength(config)
      : toDecimal(options.valuationStrength);
  const entry = prepare(input, config, strength);

  return breakdown(contextFor(entry, soloScaling(entry), config), config);
}
