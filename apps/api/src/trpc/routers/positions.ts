import {
  type Position,
  positionsListInput,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  consolidatePositions,
  convertPositions,
  filterTransactionsByAsOf,
  summarizePositions,
  type ValuationQuote,
  valuePositions,
} from "../../domain/positions";
import { getQuoteProvider, QuoteUnavailableError } from "../../lib/quotes";
import { protectedProcedure, router } from "../trpc";
import { loadTransactions } from "./transactions";

export const positionsRouter = router({
  list: protectedProcedure
    .input(positionsListInput)
    .query(async ({ ctx, input }) => {
      const history = await loadTransactions(ctx.user.id);
      const native = consolidatePositions(
        filterTransactionsByAsOf(history, input.asOf ?? null),
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
        Object.entries(input.manualPrices ?? {}).map(([ticker, price]) => [
          ticker.toUpperCase(),
          price,
        ]),
      );
      const provider = getQuoteProvider(input.quoteSource);
      const quotes = new Map<string, ValuationQuote>();
      const missing: string[] = [];
      let providerFailures = 0;
      let lastProviderError: string | null = null;

      await Promise.all(
        converted.map(async (position) => {
          if (Number(position.quantity) === 0) {
            return;
          }

          try {
            const quote = await provider.getQuote({
              ticker: position.ticker,
              assetClass: position.assetClass,
              currency: position.currency,
              asOf: input.asOf,
              manualPrice: manualPrices[position.ticker],
            });

            quotes.set(position.ticker, {
              ticker: quote.ticker,
              price: quote.price,
              asOf: quote.asOf,
            });
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

      const positions: ValuedPosition[] = valuePositions(
        converted,
        quotes,
        input.displayCurrency,
        input.usdBrlRate ?? null,
      );

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
          missing: missing.sort(),
        },
      };
    }),
});
