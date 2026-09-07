import {
  type AssetClass,
  type Currency,
  FX_SOURCE_LABELS,
  performanceHistoryInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  buildPerformanceHistory,
  createSeriesLookup,
  type PerformanceRateLookup,
  performanceSnapshots,
} from "../../domain/performance";
import {
  consolidatePositions,
  filterTransactionsByAsOf,
} from "../../domain/positions";
import { getFxProvider } from "../../lib/fx";
import {
  getQuoteProvider,
  getSeriesWithManualFallback,
  QuoteUnavailableError,
} from "../../lib/quotes";
import { protectedProcedure, router } from "../trpc";
import { loadStoredManualPrices } from "../valuation";
import { loadTransactions } from "./transactions";

/**
 * Series are requested a bit before the window so the baseline month-end
 * always has a previous close to carry forward, even across a long holiday.
 */
const SERIES_LEAD_DAYS = 12;

function shiftDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));

  return shifted.toISOString().slice(0, 10);
}

type QuotedAsset = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
};

/**
 * Tickers that need a price series: everything still open at the baseline
 * plus everything traded inside the window. Positions closed before the
 * window never reach a chart, so they cost no upstream request.
 */
function assetsToQuote(
  history: Awaited<ReturnType<typeof loadTransactions>>,
  baselineAsOf: string,
): QuotedAsset[] {
  const assets = new Map<string, QuotedAsset>();

  for (const position of consolidatePositions(
    filterTransactionsByAsOf(history, baselineAsOf),
  )) {
    if (Number(position.quantity) > 0) {
      assets.set(position.ticker, {
        ticker: position.ticker,
        assetClass: position.assetClass,
        currency: position.currency,
      });
    }
  }

  for (const entry of history) {
    if (entry.tradedAt > baselineAsOf) {
      assets.set(entry.ticker, {
        ticker: entry.ticker,
        assetClass: entry.assetClass,
        currency: entry.currency,
      });
    }
  }

  return [...assets.values()];
}

export const performanceRouter = router({
  /**
   * Monthly performance history in the display currency: portfolio value,
   * contributions, time-weighted returns and the breakdown by category.
   *
   * Prices and rates are resolved as full ranges (one upstream request per
   * ticker plus one for FX), then every month end reads the last close at or
   * before its date.
   */
  history: protectedProcedure
    .input(performanceHistoryInput)
    .query(async ({ ctx, input }) => {
      const [history, storedManualPrices] = await Promise.all([
        loadTransactions(ctx.user.id),
        loadStoredManualPrices(ctx.user.id),
      ]);
      const snapshots = performanceSnapshots(input.months);
      const baseline = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const start = shiftDays(baseline.asOf, -SERIES_LEAD_DAYS);
      const end = last.asOf;

      const manualPrices = Object.fromEntries(
        Object.entries({
          ...storedManualPrices,
          ...input.manualPrices,
        }).map(([ticker, price]) => [ticker.toUpperCase(), price]),
      );
      const assets = assetsToQuote(history, baseline.asOf);
      const needsFx = assets.some(
        (asset) => asset.currency !== input.displayCurrency,
      );

      let rateAt: PerformanceRateLookup = () => null;

      if (needsFx) {
        if (input.fxSource === "manual") {
          if (!input.manualRate) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Provide a manual USD/BRL rate",
            });
          }

          // A manual rate has no history, so it applies to every month.
          const manualRate = input.manualRate;
          rateAt = () => manualRate;
        } else {
          const provider = getFxProvider(input.fxSource);

          if (!provider) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Unknown FX source: ${input.fxSource}`,
            });
          }

          try {
            const points = await provider.getSeries({
              from: "USD",
              to: "BRL",
              start,
              end,
            });
            const lookup = createSeriesLookup(points);
            const first = points[0] ?? null;

            // Days before the first published rate fall back to it, so a
            // long holiday at the window start never blanks a month.
            rateAt = (day) => (lookup(day) ?? first)?.rate ?? null;
          } catch (error) {
            throw new TRPCError({
              code: "BAD_GATEWAY",
              message:
                error instanceof Error
                  ? `Quote from ${FX_SOURCE_LABELS[input.fxSource]} failed: ${error.message}`
                  : "Quote provider failed",
            });
          }
        }
      }

      const provider = getQuoteProvider(input.quoteSource);
      const lookups = new Map<string, (day: string) => string | null>();
      const missing: string[] = [];
      let providerFailures = 0;
      let lastProviderError: string | null = null;

      await Promise.all(
        assets.map(async (asset) => {
          try {
            const { points } = await getSeriesWithManualFallback(provider, {
              ticker: asset.ticker,
              assetClass: asset.assetClass,
              currency: asset.currency,
              start,
              end,
              manualPrice: manualPrices[asset.ticker],
            });
            const lookup = createSeriesLookup(points);

            lookups.set(asset.ticker, (day) => lookup(day)?.close ?? null);
          } catch (error) {
            missing.push(asset.ticker);

            if (!(error instanceof QuoteUnavailableError)) {
              providerFailures += 1;
              lastProviderError =
                error instanceof Error
                  ? error.message
                  : "Quote provider failed";
            }
          }
        }),
      );

      if (lookups.size === 0 && providerFailures > 0) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: lastProviderError ?? "Quote provider failed",
        });
      }

      try {
        const result = buildPerformanceHistory({
          transactions: history,
          snapshots,
          displayCurrency: input.displayCurrency,
          priceAt: (ticker, day) => lookups.get(ticker)?.(day) ?? null,
          rateAt,
        });

        return {
          ...result,
          quotes: {
            source: input.quoteSource,
            missing: missing.sort(),
          },
          fx: {
            source: input.fxSource,
            usdBrlRate: result.summary.usdBrlRate,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Could not build the performance history",
        });
      }
    }),
});
