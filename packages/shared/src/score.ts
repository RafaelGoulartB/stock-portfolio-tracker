import { z } from "zod";
import { nonNegativeDecimal, signedDecimal } from "./decimal";

/** Quarterly review grades run `0`–`10`, two decimals in practice. */
export const GRADE_MIN = 0;
export const GRADE_MAX = 10;

export const gradeSchema = nonNegativeDecimal.refine(
  (value) => Number(value) <= GRADE_MAX,
  `Use a grade between ${GRADE_MIN} and ${GRADE_MAX}`,
);

/**
 * One knot of the grade curve. Grades between two knots interpolate
 * linearly, below the first knot use its multiplier and above the last knot
 * use the last one, so a 0.01 change in grade never jumps the score.
 */
export const gradeBandSchema = z.object({
  minGrade: nonNegativeDecimal,
  multiplier: nonNegativeDecimal,
});

export type GradeBand = z.infer<typeof gradeBandSchema>;

/**
 * Every number the score engine reads. It travels with the result so a
 * screen can explain a score, and so changing the policy never means
 * touching the rules themselves.
 */
export const scoreConfigSchema = z.object({
  /** Bumped whenever the defaults below change, for traceability. */
  version: z.string(),
  /** Post-contribution weight ceiling for a normally-sized target. */
  absoluteWeightCap: nonNegativeDecimal,
  /** Post-contribution weight ceiling as a multiple of the asset's target. */
  overweightBlockFactor: nonNegativeDecimal,
  /** Trim band in weight points above the tilted target (`0.05` = 5 p.p.). */
  trimAbsoluteBand: nonNegativeDecimal,
  /** Trim band relative to the tilted target (`0.25` = 25% of it). */
  trimRelativeBand: nonNegativeDecimal,
  /** Days after a buy during which the asset's priority ramps back up. */
  cooldownDays: z.number().int().min(0),
  /** Priority multiplier on the day of a buy, rising linearly to `1`. */
  cooldownFloor: nonNegativeDecimal,
  /** How many of the newest graded quarters the grade signal reads. */
  gradeWindowQuarters: z.number().int().min(1),
  /** A grade loses half its weight after this many quarters. */
  gradeHalfLifeQuarters: z.number().int().min(1),
  /**
   * Pseudo-quarters of the ungraded multiplier mixed into the grade signal,
   * so one grade moves the multiplier less than four consistent ones.
   */
  gradePriorQuarters: nonNegativeDecimal,
  /** Grade curve knots, ascending by `minGrade`. */
  gradeBands: z.array(gradeBandSchema).min(1),
  /** Multiplier for an asset with no graded quarter yet. */
  ungradedMultiplier: nonNegativeDecimal,
  /**
   * Log mispricing ignored as valuation noise. `0.05` means prices within
   * roughly ±5% of fair value do not tilt the target.
   */
  valuationDeadZone: nonNegativeDecimal,
  /** Exponent applied to the confident mispricing; `0` ignores valuation. */
  valuationSensitivity: nonNegativeDecimal,
  /** Lowest multiplier valuation may apply to a target. */
  tiltMin: nonNegativeDecimal,
  /** Highest multiplier valuation may apply to a target. */
  tiltMax: nonNegativeDecimal,
  /** A fair value loses half its confidence after this many quarters. */
  fairValueHalfLifeQuarters: z.number().int().min(1),
});

export type ScoreConfig = z.infer<typeof scoreConfigSchema>;

/** Version stamp written when the user overrides the built-in defaults. */
export const CUSTOM_SCORE_VERSION = "custom";

/**
 * User-editable fields of {@link ScoreConfig}. The API owns `version`
 * (`DEFAULT_SCORE_CONFIG.version` or {@link CUSTOM_SCORE_VERSION}).
 */
export const scoreConfigUpdateSchema = scoreConfigSchema
  .omit({ version: true })
  .superRefine((config, ctx) => {
    for (let index = 1; index < config.gradeBands.length; index += 1) {
      const previous = Number(config.gradeBands[index - 1]?.minGrade);
      const current = Number(config.gradeBands[index]?.minGrade);

      if (!(current > previous)) {
        ctx.addIssue({
          code: "custom",
          path: ["gradeBands", index, "minGrade"],
          message: "Grade bands must be strictly ascending by minimum grade",
        });
      }
    }

    if (Number(config.cooldownFloor) > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["cooldownFloor"],
        message: "Must be at most 1",
      });
    }

    if (Number(config.tiltMin) > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["tiltMin"],
        message: "Must be at most 1",
      });
    }

    if (Number(config.tiltMax) < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["tiltMax"],
        message: "Must be at least 1",
      });
    }
  });

export type ScoreConfigUpdate = z.infer<typeof scoreConfigUpdateSchema>;

/**
 * Score v2 defaults.
 *
 * - The grade knots keep the spreadsheet's values (`0` → ×0.5, `4` → ×0.7,
 *   `7` → ×0.8, `8` → ×1) but are now interpolated instead of stepped.
 * - Trims follow the 5/25 tolerance-band rule: act when weight runs more
 *   than 5 p.p. or 25% past the tilted target, whichever is tighter.
 * - Valuation ignores ±5% as noise and can move a target between ×0.5 and
 *   ×1.5. In a 200-scenario simulation against v1, a 5% band kept most of
 *   the tracking-error gain while matching v1's value capture; 10% gave up
 *   too much signal when fair values are accurate.
 */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  version: "2026-09-26-v2",
  absoluteWeightCap: "0.05",
  overweightBlockFactor: "1.3",
  trimAbsoluteBand: "0.05",
  trimRelativeBand: "0.25",
  cooldownDays: 45,
  cooldownFloor: "0.25",
  gradeWindowQuarters: 4,
  gradeHalfLifeQuarters: 4,
  gradePriorQuarters: "1",
  gradeBands: [
    { minGrade: "0", multiplier: "0.5" },
    { minGrade: "4", multiplier: "0.7" },
    { minGrade: "7", multiplier: "0.8" },
    { minGrade: "8", multiplier: "1" },
  ],
  ungradedMultiplier: "1",
  valuationDeadZone: "0.05",
  valuationSensitivity: "1",
  tiltMin: "0.5",
  tiltMax: "1.5",
  fairValueHalfLifeQuarters: 2,
};

/**
 * Which rule produced a score. Rules are evaluated in this order and the
 * first match wins, so the ids double as the engine's priority list.
 *
 * - `no-target` — no target weight set, so there is nothing to close.
 * - `no-quote` — held, but neither a live nor a manual price values it, so
 *   its current weight is unknown rather than zero.
 * - `trim-overweight` — expensive *and* past the trim band: negative score.
 * - `weight-cap` — past the portfolio ceiling when its target does not
 *   explicitly exceed that ceiling.
 * - `target-overweight` — past its own target by more than the block factor.
 * - `cooldown` — bought recently: still a candidate, at reduced priority.
 * - `gap-weighted` — the normal case: relative gap times priority.
 */
export const SCORE_RULE_IDS = [
  "no-target",
  "no-quote",
  "trim-overweight",
  "weight-cap",
  "target-overweight",
  "cooldown",
  "gap-weighted",
] as const;

export const scoreRuleIdSchema = z.enum(SCORE_RULE_IDS);
export type ScoreRuleId = z.infer<typeof scoreRuleIdSchema>;

export const scoreBreakdownSchema = z.object({
  /**
   * Contribution priority: the share of the tilted target still missing,
   * times {@link priority}. `0.4` means 40% of the target is missing at full
   * priority. Negative means the position is a trim candidate.
   */
  value: signedDecimal,
  ruleId: scoreRuleIdSchema,
  /**
   * Target after the valuation tilt, renormalized so all tilted targets
   * keep the sum of the original ones. `null` without a target.
   */
  tiltedTarget: signedDecimal.nullable(),
  /** `tiltedTarget / targetWeight`, including renormalization. */
  tilt: nonNegativeDecimal.nullable(),
  /**
   * Confident log mispricing after the noise band and buy costs, before
   * the sensitivity exponent. `null` without a fair value or a price.
   */
  valuationSignal: signedDecimal.nullable(),
  /** `0`–`1` trust in the fair value, from its age and the grade. */
  valuationConfidence: nonNegativeDecimal.nullable(),
  /** `tiltedTarget - currentWeight`, in weight units. */
  gap: signedDecimal.nullable(),
  /** `gap / tiltedTarget`: how much of the target is still missing. */
  relativeGap: signedDecimal.nullable(),
  /** Interpolated, evidence-weighted grade multiplier. */
  gradeMultiplier: nonNegativeDecimal,
  /** Cooldown ramp, `cooldownFloor` on the day of a buy up to `1`. */
  recencyMultiplier: nonNegativeDecimal,
  /** `gradeMultiplier × recencyMultiplier`. */
  priority: nonNegativeDecimal,
  /**
   * Highest weight a contribution may take the asset to, from the absolute
   * and target-relative ceilings. `null` without a target.
   */
  maxWeight: nonNegativeDecimal.nullable(),
  /** True when a rule zeroed the score on purpose. */
  blocked: z.boolean(),
  /** Days since the last buy, `null` when the asset was never bought. */
  daysSinceContribution: z.number().int().nullable(),
  /** `YYYY-MM-DD` the cooldown ramp ends, `null` when not in cooldown. */
  cooldownUntil: z.string().nullable(),
});

export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
