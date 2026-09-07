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
 * One band of the grade lookup: every grade at or above `minGrade` (and
 * below the next band) scales the raw gap by `multiplier`. Bands replace the
 * spreadsheet's approximate `VLOOKUP` over the `scoreratings` tab.
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
  /** Weight above which a normally-sized target stops taking contributions. */
  absoluteWeightCap: nonNegativeDecimal,
  /** Blocks contributions once weight exceeds `target * this`. */
  overweightBlockFactor: nonNegativeDecimal,
  /** Above `target * this`, a negative discount turns the score into a trim. */
  trimFactor: nonNegativeDecimal,
  /** Days after a buy during which the asset takes no new contribution. */
  cooldownDays: z.number().int().min(0),
  /** How many of the newest graded quarters the average grade averages. */
  gradeWindowQuarters: z.number().int().min(1),
  /** Grade bands, ascending by `minGrade`. */
  gradeBands: z.array(gradeBandSchema).min(1),
  /** Multiplier for an asset with no graded quarter yet. */
  ungradedMultiplier: nonNegativeDecimal,
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
  });

export type ScoreConfigUpdate = z.infer<typeof scoreConfigUpdateSchema>;

/**
 * Ported from the spreadsheet formula this screen replaces:
 * grades `0`–`3` halve the gap, `4`–`6` cut it to 70%, `7` to 80%, and only
 * `8`+ keeps it whole. An ungraded asset is neutral (`1`), same as the
 * formula's `IFERROR` fallback.
 */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  version: "2026-09-07",
  absoluteWeightCap: "0.05",
  overweightBlockFactor: "1.3",
  trimFactor: "1.2",
  cooldownDays: 45,
  gradeWindowQuarters: 4,
  gradeBands: [
    { minGrade: "0", multiplier: "0.5" },
    { minGrade: "4", multiplier: "0.7" },
    { minGrade: "7", multiplier: "0.8" },
    { minGrade: "8", multiplier: "1" },
  ],
  ungradedMultiplier: "1",
};

/**
 * Which rule produced a score. Rules are evaluated in this order and the
 * first match wins, so the ids double as the engine's priority list.
 *
 * - `no-target` — no target weight set, so there is nothing to close.
 * - `trim-overweight` — expensive *and* well past target: negative score.
 * - `weight-cap` — past the portfolio ceiling when its target does not
 *   explicitly exceed that ceiling.
 * - `target-overweight` — past its own target by more than the block factor.
 * - `cooldown` — bought too recently.
 * - `gap-weighted` — the normal case: remaining gap scaled by grade.
 */
export const SCORE_RULE_IDS = [
  "no-target",
  "trim-overweight",
  "weight-cap",
  "target-overweight",
  "cooldown",
  "gap-weighted",
] as const;

export const scoreRuleIdSchema = z.enum(SCORE_RULE_IDS);
export type ScoreRuleId = z.infer<typeof scoreRuleIdSchema>;

export const scoreBreakdownSchema = z.object({
  /** Contribution priority. Negative means the position is a trim candidate. */
  value: signedDecimal,
  ruleId: scoreRuleIdSchema,
  /** `targetWeight * (1 + discount)`, `null` without a target. */
  adjustedTarget: signedDecimal.nullable(),
  /** `adjustedTarget - currentWeight` before clamping and scaling. */
  gap: signedDecimal.nullable(),
  /** Grade band applied to the gap. */
  multiplier: nonNegativeDecimal,
  /** True when a rule zeroed the score on purpose. */
  blocked: z.boolean(),
  /** Days since the last buy, `null` when the asset was never bought. */
  daysSinceContribution: z.number().int().nullable(),
  /** `YYYY-MM-DD` the cooldown expires, `null` when not in cooldown. */
  cooldownUntil: z.string().nullable(),
});

export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
