import {
  dailyTrackingInput,
  type Position,
  positionsListInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  consolidatePositions,
  convertMoney,
  convertPositions,
  filterTransactionsByAsOf,
  summarizePositions,
  valuePositions,
} from "../../domain/positions";
import {
  add,
  div,
  formatDecimal,
  isZero,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import {
  getQuoteProvider,
  getQuoteWithManualFallback,
  type MarketQuote,
  QuoteUnavailableError,
} from "../../lib/quotes";
import { protectedProcedure, router } from "../trpc";
import { loadStoredManualPrices, loadValuedPortfolio } from "../valuation";
import { finder } from "./deep-finder";
import { loadTransactions } from "./transactions";

const API_TIME_ZONE = "America/Sao_Paulo";

/** Weekends show the latest completed common market session (Friday). */
function dailySnapshotDate(now = new Date()): string | undefined {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: API_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const weekday = value("weekday");

  if (weekday !== "Sat" && weekday !== "Sun") {
    return undefined;
  }

  const date = new Date(
    Date.UTC(
      Number(value("year")),
      Number(value("month")) - 1,
      Number(value("day")),
    ),
  );
  date.setUTCDate(date.getUTCDate() - (weekday === "Sat" ? 1 : 2));

  return date.toISOString().slice(0, 10);
}

export const positionsRouter = router({
  list: protectedProcedure
    .input(positionsListInput)
    .query(async ({ ctx, input }) => {
      const { positions, missing } = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        quoteSource: input.quoteSource,
        manualPrices: input.manualPrices,
        asOf: input.asOf,
      });

      return {
        positions,
        summary: summarizePositions(
          positions,
          input.displayCurrency,
          input.usdBrlRate ?? null,
          input.asOf ?? null,
        ),
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate ?? null,
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
      const [history, storedManualPrices] = await Promise.all([
        loadTransactions(ctx.user.id),
        loadStoredManualPrices(ctx.user.id),
      ]);
      const snapshotDate = dailySnapshotDate();
      const native = consolidatePositions(
        filterTransactionsByAsOf(history, snapshotDate),
      );
      const needsRate = native.some(
        (position) => position.currency !== input.displayCurrency,
      );

      if (needsRate && !input.usdBrlRate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An USD/BRL rate is required to consolidate mixed currencies",
        });
      }

      let converted: Position[];
      try {
        converted = convertPositions(
          native,
          input.displayCurrency,
          input.usdBrlRate ?? null,
        );
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The USD/BRL rate is invalid",
        });
      }

      const manualPrices = Object.fromEntries(
        Object.entries({
          ...storedManualPrices,
          ...input.manualPrices,
        }).map(([ticker, price]) => [ticker.toUpperCase(), price]),
      );
      const provider = getQuoteProvider(input.quoteSource);
      const quotes = new Map<string, MarketQuote>();
      const missing: string[] = [];
      let providerFailures = 0;
      let lastProviderError: string | null = null;

      await Promise.all(
        converted.map(async (position) => {
          if (Number(position.quantity) === 0) {
            return;
          }

          try {
            const { quote } = await getQuoteWithManualFallback(provider, {
              ticker: position.ticker,
              assetClass: position.assetClass,
              currency: position.currency,
              asOf: snapshotDate,
              manualPrice: manualPrices[position.ticker],
            });
            quotes.set(position.ticker, quote);
          } catch (error) {
            missing.push(position.ticker);

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

      if (quotes.size === 0 && providerFailures > 0) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: lastProviderError ?? "Quote provider failed",
        });
      }

      const valued = valuePositions(
        converted,
        quotes,
        input.displayCurrency,
        input.usdBrlRate ?? null,
      ).filter((position) => Number(position.quantity) > 0);

      let previousComparableValue = ZERO;
      let currentComparableValue = ZERO;
      let advancing = 0;
      let declining = 0;
      let unchanged = 0;

      const positions = valued.map((position) => {
        const quote = quotes.get(position.ticker);

        if (!quote?.previousClose || position.convertedMarketValue == null) {
          return {
            ...position,
            previousClose: null,
            previousCloseAsOf: null,
            convertedPreviousMarketValue: null,
            dailyChange: null,
            dailyChangePercent: null,
          };
        }

        const previousNativeValue = formatDecimal(
          mul(toDecimal(position.quantity), toDecimal(quote.previousClose)),
          2,
        );
        const convertedPreviousMarketValue = convertMoney(
          previousNativeValue,
          position.currency,
          input.displayCurrency,
          input.usdBrlRate ?? "1",
        );
        const change = sub(
          toDecimal(position.convertedMarketValue),
          toDecimal(convertedPreviousMarketValue),
        );
        const dailyChange = formatDecimal(change, 2);
        const previousValue = toDecimal(convertedPreviousMarketValue);

        previousComparableValue = add(previousComparableValue, previousValue);
        currentComparableValue = add(
          currentComparableValue,
          toDecimal(position.convertedMarketValue),
        );

        if (change > ZERO) {
          advancing += 1;
        } else if (change < ZERO) {
          declining += 1;
        } else {
          unchanged += 1;
        }

        return {
          ...position,
          previousClose: quote.previousClose,
          previousCloseAsOf: quote.previousCloseAsOf ?? null,
          convertedPreviousMarketValue,
          dailyChange,
          dailyChangePercent: isZero(previousValue)
            ? null
            : formatDecimal(div(change, previousValue), 8),
        };
      });

      const dailyChange = sub(currentComparableValue, previousComparableValue);
      const portfolio = summarizePositions(
        valued,
        input.displayCurrency,
        input.usdBrlRate ?? null,
      );
      const quoteDates = [...quotes.values()].map((quote) => quote.asOf).sort();

      return {
        positions,
        summary: {
          displayCurrency: input.displayCurrency,
          marketValue: portfolio.totalMarketValue,
          previousComparableValue: formatDecimal(previousComparableValue, 2),
          currentComparableValue: formatDecimal(currentComparableValue, 2),
          dailyChange: formatDecimal(dailyChange, 2),
          dailyChangePercent: isZero(previousComparableValue)
            ? null
            : formatDecimal(div(dailyChange, previousComparableValue), 8),
          advancing,
          declining,
          unchanged,
          comparablePositions: advancing + declining + unchanged,
          openPositions: valued.length,
          asOf: quoteDates.at(-1) ?? null,
          usdBrlRate: input.usdBrlRate ?? null,
        },
        quotes: {
          source: input.quoteSource,
          missing: missing.sort(),
        },
      };
    }),

  /**
   * Open holdings ranked by a chosen window: cost basis, or a past close.
   * The crowded bar chart on Positions lives here so every ticker has room.
   */
  finder,
});
