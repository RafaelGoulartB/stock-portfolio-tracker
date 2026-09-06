import {
  DEFAULT_SCORE_CONFIG,
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
 * Contribution score engine.
 *
 * The score answers one question: *how much does this asset deserve the next
 * contribution?* It lives in weight units — `0.0075` means the asset is
 * 0.75 percentage points of portfolio away from where it should be, after
 * the discount adjustment and the quality discount. A negative score is a
 * trim signal, `0` means "skip this one".
 *
 * The policy is expected to change, so nothing here is hard-wired:
 *
 * - every threshold is a field of {@link ScoreConfig} (see
 *   `DEFAULT_SCORE_CONFIG` in `@portifolio-tracker/shared`);
 * - every decision is one entry of {@link SCORE_RULES}, evaluated in order,
 *   first match wins. Adding, reordering or dropping a rule is a local edit
 *   to that array — callers only depend on {@link scoreAsset};
 * - the result carries the rule that fired and its intermediate values, so
 *   the UI explains a score without recomputing it.
 *
 * Ported from the spreadsheet formula this screen replaces, with one
 * deliberate difference: an asset without a target weight scores `0`
 * instead of being treated as a `0%` target, which in the sheet could turn
 * any untargeted holding into a trim signal.
 */

const ONE = toDecimal("1");
/** Scores and weights share the ratio precision used across the domain. */
const WEIGHT_PLACES = 8;
const GRADE_PLACES = 2;
const MILLIS_PER_DAY = 86_400_000;

export type ScoreInput = {
  /** Target share of the portfolio, `0`–`1`. `null` when not set yet. */
  targetWeight: string | null;
  /** Current share of the portfolio, `0`–`1`. */
  currentWeight: string;
  /** Signed discount to fair value. `null` behaves as `0`. */
  discount: string | null;
  /** Average grade of the newest graded quarters, `null` when ungraded. */
  averageGrade: string | null;
  /** Date of the last buy, `YYYY-MM-DD`. `null` when never bought. */
  lastContributionAt: string | null;
  /** Reference day for the cooldown, `YYYY-MM-DD`. */
  today: string;
};

/** Everything a rule can read, computed once per asset. */
export type ScoreContext = {
  target: Decimal | null;
  weight: Decimal;
  discount: Decimal;
  /** `target * (1 + discount)`: the target a discount makes more attractive. */
  adjustedTarget: Decimal | null;
  /** `adjustedTarget - weight`. Positive means there is room to buy. */
  gap: Decimal | null;
  /** Grade band applied to a positive gap. */
  multiplier: Decimal;
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

/** Highest band whose `minGrade` the grade reaches; ungraded stays neutral. */
export function gradeMultiplier(
  averageGrade: string | null,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): Decimal {
  if (averageGrade === null) {
    return toDecimal(config.ungradedMultiplier);
  }

  const grade = toDecimal(averageGrade);
  let multiplier = toDecimal(config.ungradedMultiplier);
  let best: Decimal | null = null;

  for (const band of config.gradeBands) {
    const floor = toDecimal(band.minGrade);

    if (grade >= floor && (best === null || floor >= best)) {
      best = floor;
      multiplier = toDecimal(band.multiplier);
    }
  }

  return multiplier;
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
    // Expensive and already well past target: suggest giving weight back.
    id: "trim-overweight",
    matches: (context, config) =>
      context.target !== null &&
      context.discount < ZERO &&
      context.weight > mul(context.target, toDecimal(config.trimFactor)),
    score: (context) => context.gap ?? ZERO,
  },
  {
    id: "weight-cap",
    blocking: true,
    matches: (context, config) =>
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
    id: "cooldown",
    blocking: true,
    matches: (context, config) =>
      context.daysSinceContribution !== null &&
      context.daysSinceContribution < config.cooldownDays,
    score: () => ZERO,
  },
  {
    // Normal case: the remaining gap, scaled by the quarterly grades.
    id: "gap-weighted",
    matches: () => true,
    score: (context) =>
      mul(
        context.gap !== null && context.gap > ZERO ? context.gap : ZERO,
        context.multiplier,
      ),
  },
];

export function scoreContext(
  input: ScoreInput,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): ScoreContext {
  const target =
    input.targetWeight === null ? null : toDecimal(input.targetWeight);
  const weight = toDecimal(input.currentWeight);
  const discount = toDecimal(input.discount ?? "0");
  const adjustedTarget =
    target === null ? null : mul(target, add(ONE, discount));
  const daysSinceContribution =
    input.lastContributionAt === null
      ? null
      : daysBetween(input.lastContributionAt, input.today);
  const inCooldown =
    daysSinceContribution !== null &&
    daysSinceContribution < config.cooldownDays;

  return {
    target,
    weight,
    discount,
    adjustedTarget,
    gap: adjustedTarget === null ? null : sub(adjustedTarget, weight),
    multiplier: gradeMultiplier(input.averageGrade, config),
    daysSinceContribution,
    cooldownUntil:
      inCooldown && input.lastContributionAt !== null
        ? addDays(input.lastContributionAt, config.cooldownDays)
        : null,
  };
}

/** Runs the rule ladder and reports the score with the reasoning behind it. */
export function scoreAsset(
  input: ScoreInput,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): ScoreBreakdown {
  const context = scoreContext(input, config);
  const rule =
    SCORE_RULES.find((candidate) => candidate.matches(context, config)) ??
    SCORE_RULES[SCORE_RULES.length - 1];

  if (!rule) {
    throw new Error("The score engine has no rules configured");
  }

  return {
    value: formatDecimal(rule.score(context, config), WEIGHT_PLACES),
    ruleId: rule.id,
    adjustedTarget:
      context.adjustedTarget === null
        ? null
        : formatDecimal(context.adjustedTarget, WEIGHT_PLACES),
    gap:
      context.gap === null ? null : formatDecimal(context.gap, WEIGHT_PLACES),
    multiplier: formatDecimal(context.multiplier, GRADE_PLACES),
    blocked: rule.blocking === true,
    daysSinceContribution: context.daysSinceContribution,
    cooldownUntil: context.cooldownUntil,
  };
}

/**
 * Average of the newest `gradeWindowQuarters` graded reviews. Reviews may
 * arrive in any order; only graded ones count, so a notes-only quarter never
 * drags the average down.
 */
export function averageGrade(
  reviews: readonly { period: string; grade: string | null }[],
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): { average: string | null; quarters: number } {
  const graded = reviews
    .filter(
      (review): review is { period: string; grade: string } =>
        review.grade !== null,
    )
    // Period keys (`2026Q1`) sort chronologically as plain strings.
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, config.gradeWindowQuarters);

  if (graded.length === 0) {
    return { average: null, quarters: 0 };
  }

  let total = ZERO;

  for (const review of graded) {
    total = add(total, toDecimal(review.grade));
  }

  return {
    average: formatDecimal(
      div(total, toDecimal(String(graded.length))),
      GRADE_PLACES,
    ),
    quarters: graded.length,
  };
}
