import { z } from "zod";
import { nonNegativeDecimal, positiveDecimal, signedDecimal } from "./decimal";

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
  /**
   * Largest exponent applied to the confident mispricing, reached once the
   * investor's own track record proves the valuations informative (see
   * {@link valuationSkillSchema}). `0` ignores valuation.
   */
  valuationSensitivity: nonNegativeDecimal,
  /** Lowest multiplier valuation may apply to a target. */
  tiltMin: nonNegativeDecimal,
  /** Highest multiplier valuation may apply to a target. */
  tiltMax: nonNegativeDecimal,
  /** A fair value loses half its confidence after this many quarters. */
  fairValueHalfLifeQuarters: z.number().int().min(1),
  /**
   * Information coefficient at which the valuation reaches full strength.
   * `0.10` is a strong cross-sectional IC for 12-month returns.
   */
  icReference: positiveDecimal,
  /** IC assumed before there is any track record. */
  icPrior: signedDecimal,
  /** Weight of {@link icPrior}, in asset-review pairs. */
  icPriorPairs: z.number().int().min(0),
  /**
   * Exponent on the capped 12-1 month momentum z-score. `0.10` gives raw
   * factors between ×0.82 and ×1.22 before renormalization across the book;
   * `0` disables momentum.
   */
  momentumWeight: nonNegativeDecimal,
  /** Cap on the momentum z-score, in standard deviations. */
  momentumZCap: positiveDecimal,
  /**
   * Price move since the fair value's reference date that asks for a fresh
   * valuation. `0.25` means ±25%.
   */
  reviewDrift: positiveDecimal,
  /**
   * A sale is suggested once weight exceeds the tilted target by this share
   * of it (`0.25` = 125% of the target), and only for expensive assets.
   */
  sellBand: nonNegativeDecimal,
  /**
   * Valuation confidence (`0`–`1`) the track record must reach before a sale
   * is recommended rather than shown for information only.
   */
  sellConfidence: nonNegativeDecimal,
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

    if (Number(config.sellConfidence) > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["sellConfidence"],
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

    // Upper bounds keep every knob inside what the engine and the integer
    // columns can represent; a momentum exponent of 30 overflows decimals.
    const atMost = (path: keyof ScoreConfigFields, max: number) => {
      if (Number(config[path]) > max) {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: `Must be at most ${max}`,
        });
      }
    };

    atMost("momentumWeight", 1);
    atMost("momentumZCap", 5);
    atMost("icReference", 1);
    atMost("icPriorPairs", 100_000);
    atMost("cooldownDays", 3650);
    atMost("gradeWindowQuarters", 40);
    atMost("gradeHalfLifeQuarters", 40);
    atMost("fairValueHalfLifeQuarters", 40);

    if (Math.abs(Number(config.icPrior)) > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["icPrior"],
        message: "Must be between -1 and 1",
      });
    }
  });

type ScoreConfigFields = Omit<ScoreConfig, "version" | "gradeBands">;

export type ScoreConfigUpdate = z.infer<typeof scoreConfigUpdateSchema>;

/**
 * Score v3 defaults, chosen by Monte Carlo study (see
 * `tasks/plan-contribution-score.md`).
 *
 * - The grade knots keep the spreadsheet's values (`0` → ×0.5, `4` → ×0.7,
 *   `7` → ×0.8, `8` → ×1), interpolated instead of stepped.
 * - Trims follow the 5/25 tolerance-band rule.
 * - Valuation strength is learned: `valuationSensitivity × min(1, IC ÷
 *   icReference)`, starting from `icPrior` (half strength) until reviews
 *   have a 12-month track record. No dead zone: noisy valuations are shrunk
 *   by the learned strength instead of cut.
 * - Light momentum (`0.10` on a z-score capped at ±2) breaks ties between
 *   buying dips and following trends; stronger momentum lost when prices
 *   revert fast.
 */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  version: "2026-09-27-v3",
  absoluteWeightCap: "0.05",
  overweightBlockFactor: "2",
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
  valuationDeadZone: "0",
  valuationSensitivity: "3",
  tiltMin: "0.2",
  tiltMax: "3",
  fairValueHalfLifeQuarters: 2,
  icReference: "0.10",
  icPrior: "0.05",
  icPriorPairs: 240,
  momentumWeight: "0.10",
  momentumZCap: "2",
  reviewDrift: "0.25",
  sellBand: "0.25",
  sellConfidence: "0.8",
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
  /** Part of {@link tilt} from valuation, renormalized among valued assets. */
  valuationTilt: nonNegativeDecimal.nullable(),
  /** Part of {@link tilt} from momentum, renormalized across the book. */
  momentumTilt: nonNegativeDecimal.nullable(),
  /**
   * Capped cross-sectional z-score of the 12-1 month return, `null` when the
   * asset has no year of prices. Without it, {@link momentumTilt} is only the
   * book's renormalization, not a trend of this asset.
   */
  momentumZ: signedDecimal.nullable(),
  /**
   * Confident log mispricing after the noise band and buy costs, before
   * the sensitivity exponent. `null` without a fair value or a price.
   */
  valuationSignal: signedDecimal.nullable(),
  /** `0`–`1` trust in the fair value, from its age and the grade. */
  valuationConfidence: nonNegativeDecimal.nullable(),
  /**
   * Weight a trim or a sale brings the asset back to: the tilted target, but
   * never below `target × own valuation tilt`. Renormalization shrinks a
   * fairly priced asset's target when another one is cheap; that alone must
   * not make it look overweight. `null` without a target.
   */
  trimTarget: signedDecimal.nullable(),
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
  /**
   * Price change since the fair value was written (the later of its quarter
   * end and its last edit), `null` without a fair value or a reference price.
   */
  priceSinceFairValue: signedDecimal.nullable(),
  /** True when {@link priceSinceFairValue} crossed `reviewDrift`. */
  reviewSuggested: z.boolean(),
});

export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

/**
 * How well the investor's fair values have anticipated returns: the pooled
 * cross-sectional correlation between each review's log discount and the
 * next 12 months of log return (information coefficient), shrunk toward
 * `icPrior`. It sets how strongly valuation may tilt targets.
 */
export const valuationSkillSchema = z.object({
  /** Raw pooled IC, `null` until any review has a 12-month outcome. */
  ic: signedDecimal.nullable(),
  /** IC after shrinkage toward the prior. */
  shrunkIc: signedDecimal,
  /** `min(1, max(0, shrunkIc ÷ icReference))`. */
  confidence: nonNegativeDecimal,
  /** Effective valuation exponent: `valuationSensitivity × confidence`. */
  strength: nonNegativeDecimal,
  /** Asset-review pairs with a 12-month outcome. */
  pairs: z.number().int().min(0),
  /** Review quarters that contributed pairs. */
  periods: z.number().int().min(0),
  /** Fair-value reviews still waiting for their 12-month outcome. */
  pending: z.number().int().min(0),
  /**
   * Reviews whose outcome is due but whose prices could not be loaded. Above
   * zero the track record is partial, so sales are never recommended.
   */
  missing: z.number().int().min(0),
});

export type ValuationSkill = z.infer<typeof valuationSkillSchema>;
