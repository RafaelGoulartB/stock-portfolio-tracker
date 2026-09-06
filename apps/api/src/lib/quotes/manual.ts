import { toDecimal } from "../decimal";
import {
  type MarketQuote,
  type QuoteProvider,
  type QuoteRequest,
  QuoteUnavailableError,
} from "./provider";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * User-owned prices for assets without a public quote (fixed income, opaque
 * tickers). Values arrive per request from the frontend until a server-side
 * price table lands; the provider interface stays the same either way.
 */
export class ManualQuoteProvider implements QuoteProvider {
  readonly id = "manual" as const;
  readonly label = "Manual prices";

  async getQuote(request: QuoteRequest): Promise<MarketQuote> {
    if (!request.manualPrice) {
      throw new QuoteUnavailableError(
        request.ticker,
        `No manual price for ${request.ticker}`,
      );
    }

    if (toDecimal(request.manualPrice) <= 0n) {
      throw new QuoteUnavailableError(
        request.ticker,
        `Invalid manual price for ${request.ticker}`,
      );
    }

    return {
      ticker: request.ticker,
      price: request.manualPrice,
      currency: request.currency,
      asOf: request.asOf ?? todayUtc(),
      source: this.id,
    };
  }
}
