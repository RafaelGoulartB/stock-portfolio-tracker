// DEV-ONLY tRPC router for manual testing. Never import this from
// production domain code.
//
// Inserts a fixed batch of demo transactions, allocation targets and
// quarterly reviews into the signed-in account so empty states, mixed
// BRL/USD consolidation, scores, fair-value history and the asset-detail
// page can be exercised without hand-typing data. It always refuses to
// run when NODE_ENV is production.

import { createTransactionInput } from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq, max } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../db";
import { allocationAssets, assetReviews, transactions } from "../../db/schema";
import {
  DEV_SEED_ASSETS,
  DEV_SEED_FIXTURES,
  DEV_SEED_REVIEWS,
} from "../../dev/seed-fixtures";
import {
  availableQuantity,
  type ConsolidationInput,
  tickerCurrencies,
} from "../../domain/positions";
import { isProduction } from "../../env";
import { toDecimal } from "../../lib/decimal";
import { protectedProcedure, router } from "../trpc";

export const devSeedRouter = router({
  seedDemo: protectedProcedure.mutation(async ({ ctx }) => {
    if (isProduction) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Demo seeding is disabled in production",
      });
    }

    const history = await db
      .select({
        ticker: transactions.ticker,
        assetClass: transactions.assetClass,
        currency: transactions.currency,
        side: transactions.side,
        quantity: transactions.quantity,
        price: transactions.price,
        fees: transactions.fees,
        tradedAt: transactions.tradedAt,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .where(eq(transactions.userId, ctx.user.id));

    // Replays the same guards as the production create endpoint so the
    // seed batch can never corrupt the one-currency-per-ticker invariant
    // or oversell a holding when the account already has trades.
    const accepted: z.output<typeof createTransactionInput>[] = [];
    const staged: ConsolidationInput[] = [];
    const skippedTickers = new Set<string>();
    const existingTradeTickers = new Set(
      history.map((row) => row.ticker.toUpperCase()),
    );

    // Legacy rows written before the BR/US stock split read as `stock`.
    const normalizedHistory = history.map((row) => ({
      ...row,
      assetClass:
        (row.assetClass as string) === "stock" ? "stock_br" : row.assetClass,
    })) as ConsolidationInput[];

    for (const candidate of DEV_SEED_FIXTURES) {
      const parsed = createTransactionInput.safeParse(candidate);

      if (!parsed.success || skippedTickers.has(parsed.data.ticker)) {
        if (parsed.success) {
          skippedTickers.add(parsed.data.ticker);
        }
        continue;
      }

      const trade = parsed.data;

      if (existingTradeTickers.has(trade.ticker)) {
        skippedTickers.add(trade.ticker);
        continue;
      }

      const combined = [...normalizedHistory, ...staged];
      const used = tickerCurrencies(combined, trade.ticker);

      if (used.length > 0 && !used.includes(trade.currency)) {
        for (const fixture of DEV_SEED_FIXTURES) {
          if (fixture.ticker === trade.ticker) {
            skippedTickers.add(fixture.ticker);
          }
        }
        continue;
      }

      if (
        trade.side === "sell" &&
        toDecimal(trade.quantity) >
          toDecimal(availableQuantity(combined, trade.ticker))
      ) {
        skippedTickers.add(trade.ticker);
        continue;
      }

      accepted.push(trade);
      staged.push({ ...trade, createdAt: new Date() });
    }

    if (accepted.length > 0) {
      await db.insert(transactions).values(
        accepted.map((trade) => ({
          userId: ctx.user.id,
          ticker: trade.ticker,
          assetClass: trade.assetClass,
          currency: trade.currency,
          side: trade.side,
          quantity: trade.quantity,
          price: trade.price,
          fees: trade.fees,
          tradedAt: trade.tradedAt,
          notes: trade.notes && trade.notes.length > 0 ? trade.notes : null,
        })),
      );
    }

    const [highest] = await db
      .select({ value: max(allocationAssets.sortOrder) })
      .from(allocationAssets)
      .where(eq(allocationAssets.userId, ctx.user.id));
    let sortOrder = (highest?.value ?? 0) + 1;

    const assetsInserted =
      DEV_SEED_ASSETS.length === 0
        ? []
        : await db
            .insert(allocationAssets)
            .values(
              DEV_SEED_ASSETS.map((asset) => ({
                userId: ctx.user.id,
                ticker: asset.ticker,
                assetClass: asset.assetClass,
                currency: asset.currency,
                targetWeight: asset.targetWeight,
                valuationRef: asset.valuationRef,
                sortOrder: sortOrder++,
              })),
            )
            .onConflictDoNothing({
              target: [allocationAssets.userId, allocationAssets.ticker],
            })
            .returning({ ticker: allocationAssets.ticker });

    const reviewsInserted =
      DEV_SEED_REVIEWS.length === 0
        ? []
        : await db
            .insert(assetReviews)
            .values(
              DEV_SEED_REVIEWS.map((review) => ({
                userId: ctx.user.id,
                ticker: review.ticker,
                period: review.period,
                grade: review.grade,
                notes: review.notes,
                fairValue: review.fairValue,
                fairValueRef: review.fairValueRef,
                watchNext: review.watchNext,
              })),
            )
            .onConflictDoNothing({
              target: [
                assetReviews.userId,
                assetReviews.ticker,
                assetReviews.period,
              ],
            })
            .returning({
              ticker: assetReviews.ticker,
              period: assetReviews.period,
            });

    if (
      accepted.length === 0 &&
      assetsInserted.length === 0 &&
      reviewsInserted.length === 0
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Demo data already matches the signed-in account",
      });
    }

    return {
      inserted: accepted.length,
      assetsInserted: assetsInserted.length,
      reviewsInserted: reviewsInserted.length,
      skippedTickers: [...skippedTickers].sort(),
    };
  }),
});
