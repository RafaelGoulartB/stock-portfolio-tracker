import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  assetTaxProfiles,
  brokerNotes,
  brokerSecurityAliases,
  cashBalances,
  categories,
  corporateActions,
  darfPayments,
  foreignCashBalances,
  incomeTaxSettings,
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
    | typeof brokerSecurityAliases
    | typeof incomeTaxSettings
    | typeof darfPayments
    | typeof assetTaxProfiles
    | typeof foreignCashBalances,
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
      incomeTaxSettingsCount,
      darfPaymentCount,
      assetTaxProfileCount,
      foreignCashBalanceCount,
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
      countForUser(incomeTaxSettings, ctx.user.id),
      countForUser(darfPayments, ctx.user.id),
      countForUser(assetTaxProfiles, ctx.user.id),
      countForUser(foreignCashBalances, ctx.user.id),
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
      incomeTaxSettings: incomeTaxSettingsCount,
      darfPayments: darfPaymentCount,
      assetTaxProfiles: assetTaxProfileCount,
      foreignCashBalances: foreignCashBalanceCount,
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
        await tx
          .delete(incomeTaxSettings)
          .where(eq(incomeTaxSettings.userId, ctx.user.id));
        await tx
          .delete(darfPayments)
          .where(eq(darfPayments.userId, ctx.user.id));
        await tx
          .delete(assetTaxProfiles)
          .where(eq(assetTaxProfiles.userId, ctx.user.id));
        await tx
          .delete(foreignCashBalances)
          .where(eq(foreignCashBalances.userId, ctx.user.id));
      });

      return { ok: true as const };
    }),
});
