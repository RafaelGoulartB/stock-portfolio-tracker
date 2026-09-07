import { z } from "zod";
import { positiveDecimal } from "./decimal";

/**
 * How a contribution is turned into suggested slices. Distinct from
 * {@link ScoreConfig}: the score ranks *who* deserves capital, this policy
 * sizes *how many* names the amount can meaningfully move and how far any
 * one of them may take.
 */
export const contributionPlanConfigSchema = z.object({
  /** Bumped whenever the defaults below change, for traceability. */
  version: z.string(),
  /**
   * Minimum portfolio-weight effect on a small book (`V` at or below
   * {@link CONTRIBUTION_PLAN_SMALL_BOOK_VALUE}). `0.02` means 2%.
   */
  smallBookImpact: positiveDecimal,
  /**
   * Minimum portfolio-weight effect on a large book (`V` at or above
   * {@link CONTRIBUTION_PLAN_LARGE_BOOK_VALUE}). `0.005` means 0.50%.
   */
  largeBookImpact: positiveDecimal,
  /**
   * Hard cap on one asset's share of the contribution when two or more
   * names are selected. `0.70` means 70%.
   */
  maxShare: positiveDecimal.refine(
    (value) => Number(value) <= 1,
    "Must be at most 1",
  ),
  /** Diversification ceiling for a relatively large contribution. */
  maxAssets: z.number().int().min(1).max(50),
});

export type ContributionPlanConfig = z.infer<
  typeof contributionPlanConfigSchema
>;

/** Version stamp written when the user overrides the built-in defaults. */
export const CUSTOM_CONTRIBUTION_PLAN_VERSION = "custom";

/**
 * Display-currency book size at or below which {@link ContributionPlanConfig.smallBookImpact}
 * applies in full. Between this and {@link CONTRIBUTION_PLAN_LARGE_BOOK_VALUE}
 * the impact is interpolated in log space.
 */
export const CONTRIBUTION_PLAN_SMALL_BOOK_VALUE = "100000";

/** Display-currency book size at or above which the large-book impact applies. */
export const CONTRIBUTION_PLAN_LARGE_BOOK_VALUE = "1000000";

/**
 * User-editable fields of {@link ContributionPlanConfig}. The API owns
 * `version` (`DEFAULT_CONTRIBUTION_PLAN_CONFIG.version` or
 * {@link CUSTOM_CONTRIBUTION_PLAN_VERSION}).
 */
export const contributionPlanConfigUpdateSchema = contributionPlanConfigSchema
  .omit({ version: true })
  .superRefine((config, ctx) => {
    if (Number(config.smallBookImpact) < Number(config.largeBookImpact)) {
      ctx.addIssue({
        code: "custom",
        path: ["smallBookImpact"],
        message: "Small-book impact must be at least the large-book impact",
      });
    }
  });

export type ContributionPlanConfigUpdate = z.infer<
  typeof contributionPlanConfigUpdateSchema
>;

/**
 * Small books need a larger relative move to justify another name; large
 * books can rebalance in finer weight steps because the same percentage is
 * already a real cheque. One name may not take more than 70% when others
 * sit at the table. Five names is the diversification ceiling.
 */
export const DEFAULT_CONTRIBUTION_PLAN_CONFIG: ContributionPlanConfig = {
  version: "2026-09-07b",
  smallBookImpact: "0.02",
  largeBookImpact: "0.005",
  maxShare: "0.70",
  maxAssets: 5,
};
