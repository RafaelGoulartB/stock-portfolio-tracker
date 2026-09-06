import {
  getBatchQuotesInput,
  getQuoteInput,
  type SpotQuote,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  getQuoteProvider,
  listQuoteSources,
  QuoteUnavailableError,
} from "../../lib/quotes";
import { protectedProcedure, router } from "../trpc";

export const quotesRouter = router({
  /** Quote sources the user can pick from. New providers appear here. */
  listSources: protectedProcedure.query(() => listQuoteSources()),

  getQuote: protectedProcedure
    .input(getQuoteInput)
    .query(async ({ input }): Promise<SpotQuote> => {
      const provider = getQuoteProvider(input.source);

      try {
        return await provider.getQuote({
          ticker: input.ticker,
          assetClass: input.assetClass,
          currency: input.currency ?? "BRL",
          asOf: input.asOf,
          manualPrice: input.manualPrice,
        });
      } catch (error) {
        if (error instanceof QuoteUnavailableError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }

        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            error instanceof Error ? error.message : "Quote provider failed",
        });
      }
    }),

  /**
   * Batch lookup that never fails per ticker: unknown tickers land in
   * `missing` so snapshots can value what they can and flag the rest.
   */
  getBatch: protectedProcedure
    .input(getBatchQuotesInput)
    .query(
      async ({
        input,
      }): Promise<{ quotes: SpotQuote[]; missing: string[] }> => {
        const provider = getQuoteProvider(input.source);
        const quotes: SpotQuote[] = [];
        const missing: string[] = [];

        await Promise.all(
          input.assets.map(async (asset) => {
            try {
              quotes.push(
                await provider.getQuote({
                  ticker: asset.ticker,
                  assetClass: asset.assetClass,
                  currency: asset.currency,
                  asOf: input.asOf,
                  manualPrice: input.manualPrices?.[asset.ticker],
                }),
              );
            } catch (error) {
              if (error instanceof QuoteUnavailableError) {
                missing.push(asset.ticker);
                return;
              }

              throw error;
            }
          }),
        );

        quotes.sort((a, b) => a.ticker.localeCompare(b.ticker));

        return { quotes, missing };
      },
    ),
});
