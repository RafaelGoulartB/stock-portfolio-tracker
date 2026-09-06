import type {
  Currency,
  Position,
  QuoteSource,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  type ConsolidationInput,
  consolidatePositions,
  convertPositions,
  filterTransactionsByAsOf,
  type ValuationQuote,
  valuePositions,
} from "../domain/positions";
import { getQuoteProvider, QuoteUnavailableError } from "../lib/quotes";
import { loadTransactions } from "./routers/transactions";

export type ValuationRequest = {
  userId: string;
  displayCurrency: Currency;
  /** Required whenever the portfolio mixes currencies. */
  usdBrlRate?: string;
  quoteSource: QuoteSource;
  /** Per-ticker native prices for the `manual` source, any casing. */
  manualPrices?: Record<string, string>;
  /** `YYYY-MM-DD` snapshot; omitted values the live portfolio. */
  asOf?: string;
};

export type ValuationResult = {
  /** The whole trade log, so callers can derive their own dates. */
  transactions: ConsolidationInput[];
  positions: ValuedPosition[];
  /** Tickers the provider had no price for, ascending. */
  missing: string[];
};

/**
 * Consolidates the trade log, converts it into the display currency and
 * values every open position with the requested quote source. Shared by the
 * screens that need a valued portfolio (positions, allocation) so the
 * conversion and quote-failure rules live in one place.
 *
 * A ticker without a quote is reported in `missing` and keeps `null` market
 * fields; only a provider that fails for *every* ticker raises.
 */
export async function loadValuedPortfolio(
  request: ValuationRequest,
): Promise<ValuationResult> {
  const transactions = await loadTransactions(request.userId);
  const native = consolidatePositions(
    filterTransactionsByAsOf(transactions, request.asOf ?? null),
  );
  const needsRate = native.some(
    (position) => position.currency !== request.displayCurrency,
  );

  if (needsRate && !request.usdBrlRate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An USD/BRL rate is required to consolidate mixed currencies",
    });
  }

  let converted: Position[];

  try {
    converted = convertPositions(
      native,
      request.displayCurrency,
      request.usdBrlRate ?? null,
    );
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The USD/BRL rate is invalid",
    });
  }

  const manualPrices = Object.fromEntries(
    Object.entries(request.manualPrices ?? {}).map(([ticker, price]) => [
      ticker.toUpperCase(),
      price,
    ]),
  );
  const provider = getQuoteProvider(request.quoteSource);
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
          asOf: request.asOf,
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
            error instanceof Error ? error.message : "Quote provider failed";
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

  return {
    transactions,
    positions: valuePositions(
      converted,
      quotes,
      request.displayCurrency,
      request.usdBrlRate ?? null,
    ),
    missing: missing.sort(),
  };
}
