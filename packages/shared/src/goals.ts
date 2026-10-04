import { z } from "zod";
import { currencySchema } from "./currency";
import { nonNegativeDecimal, positiveDecimal } from "./decimal";
import { positionsListInput } from "./fx";

/**
 * What the goal is stated as: the monthly income the portfolio should be
 * able to pay, or the portfolio value itself.
 */
export const GOAL_TARGET_KINDS = ["income", "value"] as const;
export const goalTargetKindSchema = z.enum(GOAL_TARGET_KINDS);
export type GoalTargetKind = z.infer<typeof goalTargetKindSchema>;

/** Projection scenarios, from the most to the least cautious. */
export const GOAL_SCENARIOS = ["conservative", "base", "optimistic"] as const;
export type GoalScenario = (typeof GOAL_SCENARIOS)[number];

/** Longest projection, in years. A goal further out is "not reached". */
export const GOAL_MAX_YEARS = 60;

/**
 * Defaults for a new goal. Returns are real (above inflation) yearly rates, so
 * every projected amount is in today's money; 4% is the classic sustainable
 * withdrawal rate.
 */
export const DEFAULT_GOAL_RATES = {
  withdrawalRate: "0.04",
  conservativeReturn: "0.02",
  baseReturn: "0.04",
  optimisticReturn: "0.06",
} as const;

/** Real yearly return, `0`–`20%`. */
const realReturn = nonNegativeDecimal.refine(
  (value) => Number(value) <= 0.2,
  "Use a yearly real return up to 20%",
);

/** `YYYY-MM`. */
export const goalMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the YYYY-MM format");

export const goalSettingsInput = z
  .object({
    /** Currency every amount of the goal is stated in. */
    currency: currencySchema,
    /** Planned contribution per month. */
    monthlyContribution: nonNegativeDecimal,
    targetKind: goalTargetKindSchema,
    /** Monthly income or portfolio value, per `targetKind`. */
    targetAmount: positiveDecimal,
    /** Share of the portfolio withdrawn per year to live on. */
    withdrawalRate: positiveDecimal.refine(
      (value) => Number(value) <= 0.2,
      "Use a withdrawal rate up to 20%",
    ),
    conservativeReturn: realReturn,
    baseReturn: realReturn,
    optimisticReturn: realReturn,
    /** Month the goal should be reached by, optional. */
    targetMonth: goalMonthSchema.nullable(),
  })
  .refine(
    (goal) =>
      Number(goal.conservativeReturn) <= Number(goal.baseReturn) &&
      Number(goal.baseReturn) <= Number(goal.optimisticReturn),
    {
      message: "Order the returns from conservative to optimistic",
      path: ["baseReturn"],
    },
  );

export type GoalSettingsInput = z.infer<typeof goalSettingsInput>;

export type GoalSettings = GoalSettingsInput & { updatedAt: string };

/** The live portfolio request, without a past snapshot. */
export const goalOverviewInput = positionsListInput.omit({ asOf: true });

export type GoalOverviewInput = z.input<typeof goalOverviewInput>;
