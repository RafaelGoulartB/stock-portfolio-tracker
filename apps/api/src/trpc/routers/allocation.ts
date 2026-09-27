import {
  allocationFinderInput,
  allocationHistoryInput,
  allocationListInput,
  CASH_TICKER,
  deepFinderInput,
  FX_EXECUTION_IOF,
  FX_EXECUTION_SPREAD,
  nextResultsResponseSchema,
  removeAllocationAssetInput,
  removeAssetReviewInput,
  reorderAllocationInput,
  setCashBalanceInput,
  setManualValueInput,
  upsertAllocationAssetInput,
  upsertAssetReviewInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  cashBalances,
  categories,
  transactions,
} from "../../db/schema";
import {
  buildAllocationRows,
  lastContributions,
  manualPriceFromMarketValue,
  overlayFairValueOnCloses,
  summarizeAllocation,
} from "../../domain/allocation";
import { usdBrlExecutionRate } from "../../domain/fx-execution";
import { consolidatePositions, isOpenQuantity } from "../../domain/positions";
import { loadScoreConfig } from "../../domain/score-config";
import { exemptSalesInMonth } from "../../domain/sell-plan";
import { fairValueReviews } from "../../domain/valuation-skill";
import {
  add,
  formatDecimal,
  isZero,
  mul,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import { getQuoteProvider, QuoteUnavailableError } from "../../lib/quotes";
import { getNextResults } from "../../lib/results";
import { protectedProcedure, router } from "../trpc";
import { loadValuedPortfolio } from "../valuation";
import {
  ensureAsset,
  loadAsset,
  loadAssets,
  loadReviews,
  nextSortOrder,
  tradedIdentity,
} from "./allocation-data";
import { loadAllocationFinder, quoteWatchOnly } from "./allocation-finder";
import {
  monthsAgo,
  normalizeAssetClass,
  storedManualPrices,
  today,
} from "./allocation-helpers";
import { loadMarketSignals } from "./allocation-market";
import {
  loadTransactions,
  loadTransactionsForTickers,
  readSplits,
} from "./transactions";

export const allocationRouter = router({
  /**
   * Provider-backed result dates load independently from portfolio valuation.
   * This procedure deliberately resolves to an empty list on any unexpected
   * provider failure so the allocation table itself can never be taken down.
   */
  nextResults: protectedProcedure.query(async ({ ctx }) => {
    try {
      const assets = await loadAssets(ctx.user.id);

      return nextResultsResponseSchema.parse(
        await getNextResults(
          assets.map(({ ticker, assetClass, currency }) => ({
            ticker,
            assetClass,
            currency,
          })),
          today(),
        ),
      );
    } catch {
      return { results: [], checkedAt: new Date().toISOString() };
    }
  }),

  /**
   * The allocation table: one row per open position or tracked ticker, with
   * targets, fair values, quarterly grades and the contribution score.
   */
  list: protectedProcedure
    .input(allocationListInput)
    .query(async ({ ctx, input }) => {
      const [assets, reviews, scorePolicy, history, splits] = await Promise.all(
        [
          loadAssets(ctx.user.id),
          loadReviews(ctx.user.id),
          loadScoreConfig(ctx.user.id),
          loadTransactions(ctx.user.id),
          readSplits(db, ctx.user.id),
        ],
      );
      const fairValues = fairValueReviews(reviews, splits);
      const stored = storedManualPrices(assets);
      const requestManuals = {
        ...stored,
        ...Object.fromEntries(
          Object.entries(input.manualPrices ?? {}).map(([ticker, price]) => [
            ticker.toUpperCase(),
            price,
          ]),
        ),
      };
      /**
       * Which tickers hold money depends on the ledger alone, not on any
       * quote, so the watch-only prices can be fetched in the same upstream
       * wave as the portfolio instead of a second one after it.
       */
      const invested = new Set(
        consolidatePositions(history)
          .filter((position) => isOpenQuantity(position.quantity))
          .map((position) => position.ticker),
      );
      const day = today();
      const [portfolio, watch, signals] = await Promise.all([
        loadValuedPortfolio({
          userId: ctx.user.id,
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate,
          fxSource: input.fxSource,
          manualRate: input.manualRate,
          quoteSource: input.quoteSource,
          manualPrices: requestManuals,
          storedManualPrices: stored,
          transactions: history,
          forceRefresh: input.forceRefresh,
        }),
        quoteWatchOnly(
          assets.filter((asset) => !invested.has(asset.ticker)),
          input.quoteSource,
          requestManuals,
          input.forceRefresh,
        ),
        // Price history for momentum and the valuation track record; it
        // only depends on metadata and reviews, so it joins the same wave.
        loadMarketSignals({
          assets,
          reviews: fairValues,
          today: day,
          quoteSource: input.quoteSource,
          forceRefresh: input.forceRefresh,
          config: scorePolicy.config,
        }),
      ]);
      const usdBrlRate = portfolio.usdBrlRate;
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
        usdBrlRate,
        manualValuedTickers,
        today: day,
        config: scorePolicy.config,
        momentumByTicker: signals.momentumByTicker,
        referencePrices: signals.referencePrices,
        fairValuesInTodayUnits: new Map(
          fairValues.map((review) => [
            `${review.ticker}|${review.period}`,
            review.fairValue,
          ]),
        ),
        valuationStrength: signals.skill.strength,
      });

      return {
        rows,
        summary: summarizeAllocation(
          rows,
          input.displayCurrency,
          scorePolicy.config,
        ),
        scoreConfig: scorePolicy.config,
        valuationSkill: signals.skill,
        sales: {
          /** Gross BRL sales of exempt Brazilian stocks this month. */
          exemptSoldThisMonthBrl: exemptSalesInMonth(history, day),
        },
        marketSignals: {
          unavailable: signals.unavailable,
          available: signals.available,
        },
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate,
          executionUsdBrlRate:
            usdBrlRate === null ? null : usdBrlExecutionRate(usdBrlRate),
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
   * Price movement for watch-only allocation assets. The category is applied
   * before history is fetched so a large watchlist does not fan out into
   * unnecessary provider requests.
   */
  finder: protectedProcedure
    .input(allocationFinderInput)
    .query(({ ctx, input }) => loadAllocationFinder(ctx.user.id, input)),

  /** User-triggered refresh of every watch-only series, regardless of filter. */
  refreshFinder: protectedProcedure
    .input(deepFinderInput)
    .mutation(async ({ ctx, input }) => {
      const result = await loadAllocationFinder(ctx.user.id, input, true);

      return { refreshed: result.positions.length, asOf: result.asOf };
    }),

  /**
   * Daily closes for one ticker, with the quarterly fair value carried
   * forward from each quarter end. Used by the asset detail chart. A ticker
   * the provider cannot price returns an empty series, never an error.
   */
  history: protectedProcedure
    .input(allocationHistoryInput)
    .query(async ({ ctx, input }) => {
      const [traded, asset, reviews] = await Promise.all([
        tradedIdentity(ctx.user.id, input.ticker),
        loadAsset(ctx.user.id, input.ticker),
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
      if (input.categoryId !== undefined && input.categoryId !== null) {
        const [category] = await db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.userId, ctx.user.id),
              eq(categories.id, input.categoryId),
            ),
          )
          .limit(1);

        if (!category) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Category not found",
          });
        }
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

      const row = await db.transaction(async (tx) => {
        const [asset] = await tx
          .insert(allocationAssets)
          .values({
            userId: ctx.user.id,
            ticker: input.ticker,
            // A traded ticker keeps the log's own class and currency unless the
            // caller states otherwise.
            assetClass: traded?.assetClass ?? "other",
            currency: traded?.currency ?? "USD",
            sortOrder: await nextSortOrder(ctx.user.id, tx),
            ...patch,
          })
          .onConflictDoUpdate({
            target: [allocationAssets.userId, allocationAssets.ticker],
            set: { ...patch, updatedAt: new Date() },
          })
          .returning();

        if (input.categoryId !== undefined) {
          if (input.categoryId === null) {
            await tx
              .delete(assetCategories)
              .where(
                and(
                  eq(assetCategories.userId, ctx.user.id),
                  eq(assetCategories.ticker, input.ticker),
                ),
              );
          } else {
            await tx
              .insert(assetCategories)
              .values({
                userId: ctx.user.id,
                ticker: input.ticker,
                categoryId: input.categoryId,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [assetCategories.userId, assetCategories.ticker],
                set: { categoryId: input.categoryId, updatedAt: new Date() },
              });
          }
        }

        return asset ?? null;
      });

      return row;
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

      const native = consolidatePositions(
        await loadTransactionsForTickers(ctx.user.id, [input.ticker]),
      );
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
        ...(input.watchNext !== undefined
          ? { watchNext: input.watchNext }
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
          watchNext: assetReviews.watchNext,
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
