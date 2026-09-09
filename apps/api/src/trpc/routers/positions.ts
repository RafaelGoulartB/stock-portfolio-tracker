import {
  dailyTrackingInput,
  positionsListInput,
} from "@portifolio-tracker/shared";
import {
  buildDailyTracking,
  dailyPreviousFxDay,
  dailySnapshotDate,
} from "../../domain/daily";
import {
  isOpenQuantity,
  portfolioReturnContribution,
  summarizePositions,
} from "../../domain/positions";
import { resolvePreviousUsdBrlRate } from "../fx-rate";
import { protectedProcedure, router } from "../trpc";
import { loadValuedPortfolio } from "../valuation";
import { finder } from "./deep-finder";

export const positionsRouter = router({
  list: protectedProcedure
    .input(positionsListInput)
    .query(async ({ ctx, input }) => {
      const { positions, missing, usdBrlRate } = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        fxSource: input.fxSource,
        manualRate: input.manualRate,
        quoteSource: input.quoteSource,
        manualPrices: input.manualPrices,
        asOf: input.asOf,
        forceRefresh: input.forceRefresh,
      });

      const summary = summarizePositions(
        positions,
        input.displayCurrency,
        usdBrlRate,
        input.asOf ?? null,
      );

      return {
        positions: positions.map((position) => {
          return {
            ...position,
            returnContribution: portfolioReturnContribution(
              position.convertedUnrealizedPnl,
              summary.quotedInvestedCost,
            ),
          };
        }),
        summary,
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate,
        },
        quotes: {
          source: input.quoteSource,
          asOf: input.asOf ?? null,
          missing,
        },
      };
    }),
  daily: protectedProcedure
    .input(dailyTrackingInput)
    .query(async ({ ctx, input }) => {
      const snapshotDate = dailySnapshotDate();
      const {
        positions: valued,
        missing,
        usdBrlRate,
        quotes,
      } = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        fxSource: input.fxSource,
        manualRate: input.manualRate,
        quoteSource: input.quoteSource,
        manualPrices: input.manualPrices,
        asOf: snapshotDate,
        includeCash: true,
        forceRefresh: input.forceRefresh,
      });
      const quoteDates = [...quotes.values()].map((quote) => quote.asOf).sort();
      const previousUsdBrlRate = usdBrlRate
        ? await resolvePreviousUsdBrlRate({
            currentRate: usdBrlRate,
            fxSource: input.fxSource,
            previousDay: dailyPreviousFxDay(
              snapshotDate,
              quoteDates.at(-1) ?? null,
            ),
          })
        : null;
      const tracked = buildDailyTracking({
        positions: valued.filter((position) =>
          isOpenQuantity(position.quantity),
        ),
        quotes,
        displayCurrency: input.displayCurrency,
        usdBrlRate: usdBrlRate ?? null,
        previousUsdBrlRate,
      });

      return {
        positions: tracked.positions,
        summary: {
          ...tracked.summary,
          asOf: quoteDates.at(-1) ?? null,
        },
        quotes: {
          source: input.quoteSource,
          missing,
        },
      };
    }),

  /**
   * Open holdings ranked by a chosen window: cost basis, or a past close.
   * The crowded bar chart on Positions lives here so every ticker has room.
   */
  finder,
});
