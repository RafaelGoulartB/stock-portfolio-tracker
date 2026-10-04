import {
  type GoalSettings,
  type GoalTargetKind,
  goalOverviewInput,
  goalSettingsInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { financialGoals } from "../../db/schema";
import {
  contributionHistory,
  goalTargetValue,
  monthOf,
  projectGoal,
} from "../../domain/goals";
import { apiToday } from "../../domain/performance";
import { convertMoney, summarizePositions } from "../../domain/positions";
import { resolveUsdBrlRate } from "../fx-rate";
import { protectedProcedure, router } from "../trpc";
import { loadValuedPortfolio } from "../valuation";
import { loadTransactions } from "./transactions";

/** A stored `numeric` without the column's trailing zeros. */
function plain(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

async function readGoal(userId: string): Promise<GoalSettings | null> {
  const [row] = await db
    .select()
    .from(financialGoals)
    .where(eq(financialGoals.userId, userId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    currency: row.currency,
    monthlyContribution: plain(row.monthlyContribution),
    targetKind: row.targetKind as GoalTargetKind,
    targetAmount: plain(row.targetAmount),
    withdrawalRate: plain(row.withdrawalRate),
    conservativeReturn: plain(row.conservativeReturn),
    baseReturn: plain(row.baseReturn),
    optimisticReturn: plain(row.optimisticReturn),
    targetMonth: row.targetMonth,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const goalsRouter = router({
  get: protectedProcedure.query(({ ctx }) => readGoal(ctx.user.id)),

  save: protectedProcedure
    .input(goalSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const values = { ...input, updatedAt: new Date() };

      await db
        .insert(financialGoals)
        .values({ userId: ctx.user.id, ...values })
        .onConflictDoUpdate({ target: financialGoals.userId, set: values });

      return readGoal(ctx.user.id);
    }),

  remove: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .delete(financialGoals)
      .where(eq(financialGoals.userId, ctx.user.id));

    return { ok: true as const };
  }),

  /**
   * Today's portfolio value against the goal, the projection under each
   * real-return scenario and the monthly contribution history, all in the
   * display currency. Contributions are shown even without a goal.
   */
  overview: protectedProcedure
    .input(goalOverviewInput)
    .query(async ({ ctx, input }) => {
      const [goal, transactions] = await Promise.all([
        readGoal(ctx.user.id),
        loadTransactions(ctx.user.id),
      ]);
      const valued = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        fxSource: input.fxSource,
        manualRate: input.manualRate,
        quoteSource: input.quoteSource,
        manualPrices: input.manualPrices,
        transactions,
        forceRefresh: input.forceRefresh,
      });
      const summary = summarizePositions(
        valued.positions,
        input.displayCurrency,
        valued.usdBrlRate,
        null,
      );
      const goalIsForeign =
        goal !== null && goal.currency !== input.displayCurrency;
      // Closed foreign positions never asked valuation for a rate, yet their
      // trades without a stored rate still need one to count as contributions.
      const needsRate =
        goalIsForeign ||
        transactions.some((entry) => entry.currency !== input.displayCurrency);
      const usdBrlRate =
        valued.usdBrlRate ??
        (needsRate ? ((await resolveUsdBrlRate(input)) ?? null) : null);
      const today = apiToday();
      const contributions = contributionHistory({
        transactions,
        displayCurrency: input.displayCurrency,
        usdBrlRate,
        today,
      });

      if (goal === null) {
        return {
          goal,
          displayCurrency: input.displayCurrency,
          usdBrlRate,
          currentValue: summary.totalMarketValue,
          unquotedPositions: summary.unquotedPositions,
          plannedMonthlyContribution: null,
          projection: null,
          contributions,
        };
      }

      if (goalIsForeign && usdBrlRate === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An USD/BRL rate is required to consolidate mixed currencies",
        });
      }

      // The goal is in today's money, so today's rate converts it.
      const convert = (amount: string) =>
        convertMoney(
          amount,
          goal.currency,
          input.displayCurrency,
          usdBrlRate ?? "1",
        );
      const plannedMonthlyContribution = convert(goal.monthlyContribution);
      const projection = projectGoal({
        currentValue: summary.totalMarketValue,
        monthlyContribution: plannedMonthlyContribution,
        targetValue: goalTargetValue(
          goal.targetKind,
          convert(goal.targetAmount),
          goal.withdrawalRate,
        ),
        withdrawalRate: goal.withdrawalRate,
        scenarios: [
          { scenario: "conservative", annualReturn: goal.conservativeReturn },
          { scenario: "base", annualReturn: goal.baseReturn },
          { scenario: "optimistic", annualReturn: goal.optimisticReturn },
        ],
        targetMonth: goal.targetMonth,
        currentMonth: monthOf(today),
      });

      return {
        goal,
        displayCurrency: input.displayCurrency,
        usdBrlRate,
        currentValue: summary.totalMarketValue,
        unquotedPositions: summary.unquotedPositions,
        plannedMonthlyContribution,
        projection,
        contributions,
      };
    }),
});
