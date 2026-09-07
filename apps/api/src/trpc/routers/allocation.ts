import {
  type AllocationMarkColor,
  type AssetClass,
  allocationHistoryInput,
  allocationListInput,
  allocationMarkColorSchema,
  CASH_TICKER,
  type Currency,
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
  type QuoteSource,
  removeAllocationAssetInput,
  removeAssetReviewInput,
  reorderAllocationInput,
  setCashBalanceInput,
  setManualValueInput,
  upsertAllocationAssetInput,
  upsertAssetReviewInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  allocationAssets,
  assetReviews,
  cashBalances,
  transactions,
} from "../../db/schema";
import {
  type AllocationAssetMeta,
  buildAllocationRows,
  lastContributions,
  manualPriceFromMarketValue,
  overlayFairValueOnCloses,
  type StoredReview,
  summarizeAllocation,
  type WatchQuote,
} from "../../domain/allocation";
import { usdBrlExecutionRate } from "../../domain/fx-execution";
import { consolidatePositions } from "../../domain/positions";
import { loadScoreConfig } from "../../domain/score-config";
import {
  add,
  formatDecimal,
  isZero,
  mul,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import {
  getQuoteProvider,
  getQuoteWithManualFallback,
  QuoteUnavailableError,
} from "../../lib/quotes";
import { protectedProcedure, router } from "../trpc";
import { loadValuedPortfolio } from "../valuation";
import { loadTransactions } from "./transactions";

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

/** Inclusive start of an N-month lookback, `YYYY-MM-DD`. */
function monthsAgo(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1 - months, date ?? 1),
  );

  return shifted.toISOString().slice(0, 10);
}

/** Rows written before the BR/US stock split still read back as `stock`. */
function normalizeAssetClass(value: string): AssetClass {
  return (value === "stock" ? "stock_br" : value) as AssetClass;
}

function parseMarkColor(value: string | null): AllocationMarkColor | null {
  if (value === null) {
    return null;
  }

  const parsed = allocationMarkColorSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
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
    valuationRef: row.valuationRef,
    manualPrice: row.manualPrice,
    markColor: parseMarkColor(row.markColor),
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
      fairValue: assetReviews.fairValue,
      fairValueRef: assetReviews.fairValueRef,
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

function storedManualPrices(
  assets: readonly AllocationAssetMeta[],
): Record<string, string> {
  return Object.fromEntries(
    assets
      .filter((asset) => asset.manualPrice !== null)
      .map((asset) => [asset.ticker, asset.manualPrice as string]),
  );
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
): Promise<{
  quotes: Map<string, WatchQuote>;
  missing: string[];
  manual: string[];
}> {
  const provider = getQuoteProvider(quoteSource);
  const quotes = new Map<string, WatchQuote>();
  const missing: string[] = [];
  const manual: string[] = [];

  await Promise.all(
    assets.map(async (asset) => {
      try {
        const resolved = await getQuoteWithManualFallback(provider, {
          ticker: asset.ticker,
          assetClass: asset.assetClass,
          currency: asset.currency,
          manualPrice: manualPrices[asset.ticker],
        });

        quotes.set(asset.ticker, {
          price: resolved.quote.price,
          currency: resolved.quote.currency,
        });

        if (resolved.manual) {
          manual.push(asset.ticker);
        }
      } catch {
        // One unpriced watch asset never fails the table.
        missing.push(asset.ticker);
      }
    }),
  );

  return { quotes, missing, manual };
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
   * targets, fair values, quarterly grades and the contribution score.
   */
  list: protectedProcedure
    .input(allocationListInput)
    .query(async ({ ctx, input }) => {
      const [assets, reviews, scorePolicy] = await Promise.all([
        loadAssets(ctx.user.id),
        loadReviews(ctx.user.id),
        loadScoreConfig(ctx.user.id),
      ]);
      const requestManuals = {
        ...storedManualPrices(assets),
        ...Object.fromEntries(
          Object.entries(input.manualPrices ?? {}).map(([ticker, price]) => [
            ticker.toUpperCase(),
            price,
          ]),
        ),
      };
      const portfolio = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        quoteSource: input.quoteSource,
        manualPrices: requestManuals,
      });

      const invested = new Set(
        portfolio.positions
          .filter((position) => Number(position.quantity) > 0)
          .map((position) => position.ticker),
      );
      const watch = await quoteWatchOnly(
        assets.filter((asset) => !invested.has(asset.ticker)),
        input.quoteSource,
        requestManuals,
      );
      const manualValuedTickers = new Set([
        ...portfolio.manual,
        ...watch.manual,
      ]);

      const rows = buildAllocationRows({
        positions: portfolio.positions,
        assets,
        reviews,
        lastContributionByTicker: lastContributions(portfolio.transactions),
        watchQuotes: watch.quotes,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate ?? null,
        manualValuedTickers,
        today: today(),
        config: scorePolicy.config,
      });

      return {
        rows,
        summary: summarizeAllocation(
          rows,
          input.displayCurrency,
          scorePolicy.config,
        ),
        scoreConfig: scorePolicy.config,
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate ?? null,
          executionUsdBrlRate:
            input.usdBrlRate === undefined
              ? null
              : usdBrlExecutionRate(input.usdBrlRate),
          executionSpread: FX_EXECUTION_SPREAD,
          executionIof: FX_EXECUTION_IOF,
        },
        quotes: {
          source: input.quoteSource,
          missing: [...portfolio.missing, ...watch.missing].sort(),
          manual: [...manualValuedTickers].sort(),
        },
      };
    }),

  /**
   * Daily closes for one ticker, with the quarterly fair value carried
   * forward from each quarter end. Used by the asset detail chart. A ticker
   * the provider cannot price returns an empty series, never an error.
   */
  history: protectedProcedure
    .input(allocationHistoryInput)
    .query(async ({ ctx, input }) => {
      const [traded, assets, reviews] = await Promise.all([
        tradedIdentity(ctx.user.id, input.ticker),
        loadAssets(ctx.user.id),
        db
          .select({
            period: assetReviews.period,
            fairValue: assetReviews.fairValue,
          })
          .from(assetReviews)
          .where(
            and(
              eq(assetReviews.userId, ctx.user.id),
              eq(assetReviews.ticker, input.ticker),
            ),
          )
          .orderBy(asc(assetReviews.period)),
      ]);
      const asset = assets.find((row) => row.ticker === input.ticker);
      const assetClass = traded?.assetClass ?? asset?.assetClass;
      const currency = traded?.currency ?? asset?.currency;

      if (!assetClass || !currency) {
        return {
          ticker: input.ticker,
          currency: input.displayCurrency,
          series: [],
        };
      }

      const end = today();
      const start = monthsAgo(end, 36);
      const manualPrices = Object.fromEntries(
        Object.entries(input.manualPrices ?? {}).map(([ticker, price]) => [
          ticker.toUpperCase(),
          price,
        ]),
      );
      const provider = getQuoteProvider(input.quoteSource);

      try {
        const closes = await provider.getSeries({
          ticker: input.ticker,
          assetClass,
          currency,
          start,
          end,
          manualPrice: manualPrices[input.ticker],
        });

        return {
          ticker: input.ticker,
          currency,
          series: overlayFairValueOnCloses(closes, reviews),
        };
      } catch (error) {
        if (error instanceof QuoteUnavailableError) {
          return {
            ticker: input.ticker,
            currency,
            series: [],
          };
        }

        throw error;
      }
    }),

  /**
   * Creates or patches the metadata of one ticker. Omitted fields keep their
   * stored value; an explicit `null` clears one. Upserting a ticker with no
   * trades is how a watch-only asset joins the table.
   */
  upsertAsset: protectedProcedure
    .input(upsertAllocationAssetInput)
    .mutation(async ({ ctx, input }) => {
      if (input.ticker === CASH_TICKER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cash is managed by its dedicated allocation row",
        });
      }
      if (input.targetWeight !== undefined) {
        const targets = await db
          .select({
            ticker: allocationAssets.ticker,
            targetWeight: allocationAssets.targetWeight,
          })
          .from(allocationAssets)
          .where(eq(allocationAssets.userId, ctx.user.id));
        const total = targets.reduce(
          (sum, row) =>
            row.ticker === input.ticker || row.targetWeight === null
              ? sum
              : add(sum, toDecimal(row.targetWeight)),
          input.targetWeight === null ? ZERO : toDecimal(input.targetWeight),
        );

        if (total > toDecimal("1")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Allocation targets cannot exceed 100%",
          });
        }
      }
      const traded = await tradedIdentity(ctx.user.id, input.ticker);
      const patch = {
        ...(input.assetClass !== undefined
          ? { assetClass: input.assetClass }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.targetWeight !== undefined
          ? { targetWeight: input.targetWeight }
          : {}),
        ...(input.valuationRef !== undefined
          ? { valuationRef: input.valuationRef }
          : {}),
        ...(input.markColor !== undefined
          ? { markColor: input.markColor }
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
   * Stores a display-currency market value as a native per-unit price, used
   * when the live quote provider cannot price the ticker. Clearing removes
   * the override so the row goes back to an unquoted state.
   */
  setManualValue: protectedProcedure
    .input(setManualValueInput)
    .mutation(async ({ ctx, input }) => {
      if (input.marketValue === null) {
        await db
          .update(allocationAssets)
          .set({ manualPrice: null, updatedAt: new Date() })
          .where(
            and(
              eq(allocationAssets.userId, ctx.user.id),
              eq(allocationAssets.ticker, input.ticker),
            ),
          );

        return { ticker: input.ticker, manualPrice: null };
      }

      const native = consolidatePositions(await loadTransactions(ctx.user.id));
      const position = native.find(
        (row) =>
          row.ticker === input.ticker && !isZero(toDecimal(row.quantity)),
      );

      if (!position) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A position is required to set a market value",
        });
      }

      let manualPrice: string;

      try {
        manualPrice = manualPriceFromMarketValue(
          input.marketValue,
          position.quantity,
          input.displayCurrency,
          position.currency,
          input.usdBrlRate ?? null,
        );
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An USD/BRL rate is required to set a mixed-currency value",
        });
      }

      const traded = await tradedIdentity(ctx.user.id, input.ticker);
      const [row] = await db
        .insert(allocationAssets)
        .values({
          userId: ctx.user.id,
          ticker: input.ticker,
          assetClass: traded?.assetClass ?? position.assetClass,
          currency: traded?.currency ?? position.currency,
          sortOrder: await nextSortOrder(ctx.user.id),
          manualPrice,
        })
        .onConflictDoUpdate({
          target: [allocationAssets.userId, allocationAssets.ticker],
          set: { manualPrice, updatedAt: new Date() },
        })
        .returning({
          ticker: allocationAssets.ticker,
          manualPrice: allocationAssets.manualPrice,
        });

      return row ?? { ticker: input.ticker, manualPrice };
    }),

  /** Stores the account's single cash balance, converting USD input to BRL. */
  setCashBalance: protectedProcedure
    .input(setCashBalanceInput)
    .mutation(async ({ ctx, input }) => {
      if (input.displayCurrency === "USD" && input.usdBrlRate === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An USD/BRL rate is required to set a USD cash value",
        });
      }

      const amount = formatDecimal(
        input.displayCurrency === "USD"
          ? mul(
              toDecimal(input.marketValue),
              toDecimal(input.usdBrlRate ?? "1"),
            )
          : toDecimal(input.marketValue),
        8,
      );

      const [row] = await db
        .insert(cashBalances)
        .values({ userId: ctx.user.id, amount })
        .onConflictDoUpdate({
          target: cashBalances.userId,
          set: { amount, updatedAt: new Date() },
        })
        .returning({ amount: cashBalances.amount });

      return { amount: row?.amount ?? amount, currency: "BRL" as const };
    }),

  /**
   * Stops tracking a ticker. A ticker with trades keeps its position row on
   * the screen (and its reviews); a watch-only asset leaves for good, taking
   * its quarterly reviews with it.
   */
  removeAsset: protectedProcedure
    .input(removeAllocationAssetInput)
    .mutation(async ({ ctx, input }) => {
      if (input.ticker === CASH_TICKER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cash always exists and cannot be removed",
        });
      }
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
      const tickers = input.tickers.filter((ticker) => ticker !== CASH_TICKER);
      if (tickers.length === 0) {
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
            inArray(transactions.ticker, tickers),
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
          tickers.map((ticker, index) => ({
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

      return { ordered: tickers.length };
    }),

  /** Grades and/or annotates one quarter of one asset. */
  upsertReview: protectedProcedure
    .input(upsertAssetReviewInput)
    .mutation(async ({ ctx, input }) => {
      if (input.ticker === CASH_TICKER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cash does not have quarterly reviews",
        });
      }
      await ensureAsset(ctx.user.id, input.ticker);

      const patch = {
        ...(input.grade !== undefined ? { grade: input.grade } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.fairValue !== undefined
          ? { fairValue: input.fairValue }
          : {}),
        ...(input.fairValueRef !== undefined
          ? { fairValueRef: input.fairValueRef }
          : {}),
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
          fairValue: assetReviews.fairValue,
          fairValueRef: assetReviews.fairValueRef,
        });

      return row ?? null;
    }),

  removeReview: protectedProcedure
    .input(removeAssetReviewInput)
    .mutation(async ({ ctx, input }) => {
      if (input.ticker === CASH_TICKER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cash does not have quarterly reviews",
        });
      }
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
