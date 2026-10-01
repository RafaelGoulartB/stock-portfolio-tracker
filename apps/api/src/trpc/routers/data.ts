import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  brokerNotes,
  brokerSecurityAliases,
  cashBalances,
  categories,
  corporateActions,
  transactions,
  userContributionPlanConfigs,
  userScoreConfigs,
} from "../../db/schema";
import { protectedProcedure, router } from "../trpc";

async function countForUser(
  table:
    | typeof transactions
    | typeof corporateActions
    | typeof allocationAssets
    | typeof assetReviews
    | typeof categories
    | typeof cashBalances
    | typeof assetCategories
    | typeof userScoreConfigs
    | typeof userContributionPlanConfigs
    | typeof brokerNotes
    | typeof brokerSecurityAliases,
  userId: string,
) {
  const [row] = await db
    .select({ value: count() })
    .from(table)
    .where(eq(table.userId, userId));
  return row?.value ?? 0;
}

export const dataRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const [
      transactionCount,
      allocationAssetCount,
      assetReviewCount,
      categoryCount,
      assetCategoryCount,
      scoreConfigCount,
      contributionPlanConfigCount,
      cashBalanceCount,
      corporateActionCount,
      brokerNoteCount,
      brokerSecurityAliasCount,
    ] = await Promise.all([
      countForUser(transactions, ctx.user.id),
      countForUser(allocationAssets, ctx.user.id),
      countForUser(assetReviews, ctx.user.id),
      countForUser(categories, ctx.user.id),
      countForUser(assetCategories, ctx.user.id),
      countForUser(userScoreConfigs, ctx.user.id),
      countForUser(userContributionPlanConfigs, ctx.user.id),
      countForUser(cashBalances, ctx.user.id),
      countForUser(corporateActions, ctx.user.id),
      countForUser(brokerNotes, ctx.user.id),
      countForUser(brokerSecurityAliases, ctx.user.id),
    ]);

    return {
      transactions: transactionCount,
      allocationAssets: allocationAssetCount,
      assetReviews: assetReviewCount,
      categories: categoryCount,
      assetCategories: assetCategoryCount,
      scoreConfigs: scoreConfigCount,
      contributionPlanConfigs: contributionPlanConfigCount,
      cashBalances: cashBalanceCount,
      corporateActions: corporateActionCount,
      brokerNotes: brokerNoteCount,
      brokerSecurityAliases: brokerSecurityAliasCount,
    };
  }),

  deleteAll: protectedProcedure
    .input(z.object({ confirmation: z.literal("DELETE") }))
    .mutation(async ({ ctx }) => {
      await db.transaction(async (tx) => {
        await tx
          .delete(assetCategories)
          .where(eq(assetCategories.userId, ctx.user.id));
        await tx
          .delete(assetReviews)
          .where(eq(assetReviews.userId, ctx.user.id));
        await tx
          .delete(allocationAssets)
          .where(eq(allocationAssets.userId, ctx.user.id));
        await tx
          .delete(cashBalances)
          .where(eq(cashBalances.userId, ctx.user.id));
        await tx
          .delete(transactions)
          .where(eq(transactions.userId, ctx.user.id));
        await tx.delete(brokerNotes).where(eq(brokerNotes.userId, ctx.user.id));
        await tx
          .delete(brokerSecurityAliases)
          .where(eq(brokerSecurityAliases.userId, ctx.user.id));
        await tx
          .delete(corporateActions)
          .where(eq(corporateActions.userId, ctx.user.id));
        await tx.delete(categories).where(eq(categories.userId, ctx.user.id));
        await tx
          .delete(userScoreConfigs)
          .where(eq(userScoreConfigs.userId, ctx.user.id));
        await tx
          .delete(userContributionPlanConfigs)
          .where(eq(userContributionPlanConfigs.userId, ctx.user.id));
      });

      return { ok: true as const };
    }),
});
