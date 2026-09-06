import {
  type AssetClass,
  allocationListInput,
  type Currency,
  DEFAULT_SCORE_CONFIG,
  type QuoteSource,
  removeAllocationAssetInput,
  removeAssetReviewInput,
  reorderAllocationInput,
  upsertAllocationAssetInput,
  upsertAssetReviewInput,
} from "@portifolio-tracker/shared";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "../../db";
import { allocationAssets, assetReviews, transactions } from "../../db/schema";
import {
  type AllocationAssetMeta,
  buildAllocationRows,
  lastContributions,
  type StoredReview,
  summarizeAllocation,
  type WatchQuote,
} from "../../domain/allocation";
import { getQuoteProvider } from "../../lib/quotes";
import { protectedProcedure, router } from "../trpc";
import { loadValuedPortfolio } from "../valuation";

const API_TIME_ZONE = "America/Sao_Paulo";

/** Today in the API timezone, `YYYY-MM-DD`, so cooldowns match the log. */
function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: API_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Rows written before the BR/US stock split still read back as `stock`. */
function normalizeAssetClass(value: string): AssetClass {
  return (value === "stock" ? "stock_br" : value) as AssetClass;
}

async function loadAssets(userId: string): Promise<AllocationAssetMeta[]> {
  const rows = await db
    .select()
    .from(allocationAssets)
    .where(eq(allocationAssets.userId, userId))
    .orderBy(asc(allocationAssets.sortOrder), asc(allocationAssets.ticker));

  return rows.map((row) => ({
    ticker: row.ticker,
    assetClass: normalizeAssetClass(row.assetClass),
    currency: row.currency,
    targetWeight: row.targetWeight,
    discount: row.discount,
    valuationRef: row.valuationRef,
    sortOrder: row.sortOrder,
  }));
}

async function loadReviews(userId: string): Promise<StoredReview[]> {
  const rows = await db
    .select({
      ticker: assetReviews.ticker,
      period: assetReviews.period,
      grade: assetReviews.grade,
      notes: assetReviews.notes,
    })
    .from(assetReviews)
    .where(eq(assetReviews.userId, userId))
    .orderBy(asc(assetReviews.ticker), asc(assetReviews.period));

  return rows;
}

/**
 * Class and currency of a ticker as the trade log knows it, so a metadata
 * row created by an inline edit never contradicts its own transactions.
 */
async function tradedIdentity(
  userId: string,
  ticker: string,
): Promise<{ assetClass: AssetClass; currency: Currency } | null> {
  const [row] = await db
    .select({
      assetClass: transactions.assetClass,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), eq(transactions.ticker, ticker)),
    )
    .orderBy(desc(transactions.tradedAt))
    .limit(1);

  return row
    ? {
        assetClass: normalizeAssetClass(row.assetClass),
        currency: row.currency,
      }
    : null;
}

async function nextSortOrder(userId: string): Promise<number> {
  const [row] = await db
    .select({ highest: max(allocationAssets.sortOrder) })
    .from(allocationAssets)
    .where(eq(allocationAssets.userId, userId));

  return (row?.highest ?? 0) + 1;
}

/**
 * Prices the tickers that carry no open position. They are not part of the
 * portfolio value, but the screen still shows their price and uses it to
 * size a contribution, so each one gets a quote of its own. A ticker the
 * provider cannot price is reported as missing, never as zero.
 */
async function quoteWatchOnly(
  assets: readonly AllocationAssetMeta[],
  quoteSource: QuoteSource,
  manualPrices: Record<string, string>,
): Promise<{ quotes: Map<string, WatchQuote>; missing: string[] }> {
  const provider = getQuoteProvider(quoteSource);
  const quotes = new Map<string, WatchQuote>();
  const missing: string[] = [];

  await Promise.all(
    assets.map(async (asset) => {
      try {
        const quote = await provider.getQuote({
          ticker: asset.ticker,
          assetClass: asset.assetClass,
          currency: asset.currency,
          manualPrice: manualPrices[asset.ticker],
        });

        quotes.set(asset.ticker, {
          price: quote.price,
          currency: quote.currency,
        });
      } catch {
        // One unpriced watch asset never fails the table.
        missing.push(asset.ticker);
      }
    }),
  );

  return { quotes, missing };
}

/**
 * Guarantees a ticker has an analysis row, so anything attached to it (a
 * quarterly review, a manual position in the free order) keeps the ticker
 * on the screen even with no money in it.
 */
async function ensureAsset(userId: string, ticker: string): Promise<void> {
  const traded = await tradedIdentity(userId, ticker);

  await db
    .insert(allocationAssets)
    .values({
      userId,
      ticker,
      assetClass: traded?.assetClass ?? "other",
      currency: traded?.currency ?? "USD",
      sortOrder: await nextSortOrder(userId),
    })
    .onConflictDoNothing({
      target: [allocationAssets.userId, allocationAssets.ticker],
    });
}

export const allocationRouter = router({
  /**
   * The allocation table: one row per open position or tracked ticker, with
   * targets, discounts, quarterly grades and the contribution score.
   */
  list: protectedProcedure
    .input(allocationListInput)
    .query(async ({ ctx, input }) => {
      const [portfolio, assets, reviews] = await Promise.all([
        loadValuedPortfolio({
          userId: ctx.user.id,
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate,
          quoteSource: input.quoteSource,
          manualPrices: input.manualPrices,
        }),
        loadAssets(ctx.user.id),
        loadReviews(ctx.user.id),
      ]);

      const invested = new Set(
        portfolio.positions
          .filter((position) => Number(position.quantity) > 0)
          .map((position) => position.ticker),
      );
      const manualPrices = Object.fromEntries(
        Object.entries(input.manualPrices ?? {}).map(([ticker, price]) => [
          ticker.toUpperCase(),
          price,
        ]),
      );
      const watch = await quoteWatchOnly(
        assets.filter((asset) => !invested.has(asset.ticker)),
        input.quoteSource,
        manualPrices,
      );

      const rows = buildAllocationRows({
        positions: portfolio.positions,
        assets,
        reviews,
        lastContributionByTicker: lastContributions(portfolio.transactions),
        watchQuotes: watch.quotes,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate ?? null,
        today: today(),
      });

      return {
        rows,
        summary: summarizeAllocation(rows, input.displayCurrency),
        scoreConfig: DEFAULT_SCORE_CONFIG,
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate ?? null,
        },
        quotes: {
          source: input.quoteSource,
          missing: [...portfolio.missing, ...watch.missing].sort(),
        },
      };
    }),

  /**
   * Creates or patches the metadata of one ticker. Omitted fields keep their
   * stored value; an explicit `null` clears one. Upserting a ticker with no
   * trades is how a watch-only asset joins the table.
   */
  upsertAsset: protectedProcedure
    .input(upsertAllocationAssetInput)
    .mutation(async ({ ctx, input }) => {
      const traded = await tradedIdentity(ctx.user.id, input.ticker);
      const patch = {
        ...(input.assetClass !== undefined
          ? { assetClass: input.assetClass }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.targetWeight !== undefined
          ? { targetWeight: input.targetWeight }
          : {}),
        ...(input.discount !== undefined ? { discount: input.discount } : {}),
        ...(input.valuationRef !== undefined
          ? { valuationRef: input.valuationRef }
          : {}),
      };

      const [row] = await db
        .insert(allocationAssets)
        .values({
          userId: ctx.user.id,
          ticker: input.ticker,
          // A traded ticker keeps the log's own class and currency unless the
          // caller states otherwise.
          assetClass: traded?.assetClass ?? "other",
          currency: traded?.currency ?? "USD",
          sortOrder: await nextSortOrder(ctx.user.id),
          ...patch,
        })
        .onConflictDoUpdate({
          target: [allocationAssets.userId, allocationAssets.ticker],
          set: { ...patch, updatedAt: new Date() },
        })
        .returning();

      return row ?? null;
    }),

  /**
   * Stops tracking a ticker. A ticker with trades keeps its position row on
   * the screen (and its reviews); a watch-only asset leaves for good, taking
   * its quarterly reviews with it.
   */
  removeAsset: protectedProcedure
    .input(removeAllocationAssetInput)
    .mutation(async ({ ctx, input }) => {
      const traded = await tradedIdentity(ctx.user.id, input.ticker);

      await db
        .delete(allocationAssets)
        .where(
          and(
            eq(allocationAssets.userId, ctx.user.id),
            eq(allocationAssets.ticker, input.ticker),
          ),
        );

      if (!traded) {
        await db
          .delete(assetReviews)
          .where(
            and(
              eq(assetReviews.userId, ctx.user.id),
              eq(assetReviews.ticker, input.ticker),
            ),
          );
      }

      return { ticker: input.ticker, reviewsRemoved: !traded };
    }),

  /** Persists the free-order mode: array position becomes the row rank. */
  reorder: protectedProcedure
    .input(reorderAllocationInput)
    .mutation(async ({ ctx, input }) => {
      if (input.tickers.length === 0) {
        return { ordered: 0 };
      }

      const traded = await db
        .selectDistinct({
          ticker: transactions.ticker,
          assetClass: transactions.assetClass,
          currency: transactions.currency,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, ctx.user.id),
            inArray(transactions.ticker, input.tickers),
          ),
        );
      const identityByTicker = new Map(
        traded.map((row) => [
          row.ticker,
          {
            assetClass: normalizeAssetClass(row.assetClass),
            currency: row.currency,
          },
        ]),
      );

      await db
        .insert(allocationAssets)
        .values(
          input.tickers.map((ticker, index) => ({
            userId: ctx.user.id,
            ticker,
            assetClass: identityByTicker.get(ticker)?.assetClass ?? "other",
            currency: identityByTicker.get(ticker)?.currency ?? "USD",
            sortOrder: index,
          })),
        )
        .onConflictDoUpdate({
          target: [allocationAssets.userId, allocationAssets.ticker],
          set: {
            sortOrder: sql`excluded.sort_order`,
            updatedAt: new Date(),
          },
        });

      return { ordered: input.tickers.length };
    }),

  /** Grades and/or annotates one quarter of one asset. */
  upsertReview: protectedProcedure
    .input(upsertAssetReviewInput)
    .mutation(async ({ ctx, input }) => {
      await ensureAsset(ctx.user.id, input.ticker);

      const patch = {
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };

      const [row] = await db
        .insert(assetReviews)
        .values({
          userId: ctx.user.id,
          ticker: input.ticker,
          period: input.period,
          ...patch,
        })
        .onConflictDoUpdate({
          target: [
            assetReviews.userId,
            assetReviews.ticker,
            assetReviews.period,
          ],
          set: { ...patch, updatedAt: new Date() },
        })
        .returning({
          ticker: assetReviews.ticker,
          period: assetReviews.period,
          grade: assetReviews.grade,
          notes: assetReviews.notes,
        });

      return row ?? null;
    }),

  removeReview: protectedProcedure
    .input(removeAssetReviewInput)
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(assetReviews)
        .where(
          and(
            eq(assetReviews.userId, ctx.user.id),
            eq(assetReviews.ticker, input.ticker),
            eq(assetReviews.period, input.period),
          ),
        );

      return { ticker: input.ticker, period: input.period };
    }),
});
