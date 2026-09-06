import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  categories,
  transactions,
} from "../../db/schema";
import { protectedProcedure, router } from "../trpc";

async function countForUser(
  table:
    | typeof transactions
    | typeof allocationAssets
    | typeof assetReviews
    | typeof categories
    | typeof assetCategories,
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
    ] = await Promise.all([
      countForUser(transactions, ctx.user.id),
      countForUser(allocationAssets, ctx.user.id),
      countForUser(assetReviews, ctx.user.id),
      countForUser(categories, ctx.user.id),
      countForUser(assetCategories, ctx.user.id),
    ]);

    return {
      transactions: transactionCount,
      allocationAssets: allocationAssetCount,
      assetReviews: assetReviewCount,
      categories: categoryCount,
      assetCategories: assetCategoryCount,
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
          .delete(transactions)
          .where(eq(transactions.userId, ctx.user.id));
        await tx.delete(categories).where(eq(categories.userId, ctx.user.id));
      });

      return { ok: true as const };
    }),
});
