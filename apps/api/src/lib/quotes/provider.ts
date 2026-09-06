import type {
  AssetClass,
  Currency,
  QuoteSource,
} from "@portifolio-tracker/shared";

/** One market price for a ticker in its native currency. */
export type MarketQuote = {
  ticker: string;
  /** Native-currency price per unit, as a decimal string. */
  price: string;
  currency: Currency;
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  asOf: string;
  source: QuoteSource;
};

export type QuoteRequest = {
  ticker: string;
  assetClass: AssetClass;
  /** Native currency of the position being valued. */
  currency: Currency;
  /** `YYYY-MM-DD` close; omitted means the latest spot quote. */
  asOf?: string;
  /** Required by the manual provider. */
  manualPrice?: string;
};

/** Thrown when a provider has no price for a ticker (delisted, weekend gap, unsupported class). Routers catch this per ticker so one gap never fails a whole snapshot. */
export class QuoteUnavailableError extends Error {
  readonly ticker: string;

  constructor(ticker: string, message?: string) {
    super(message ?? `No quote available for ${ticker}`);
    this.name = "QuoteUnavailableError";
    this.ticker = ticker;
  }
}

/**
 * Market-quote source contract. To add a new source (Brapi, Yahoo, ...),
 * implement this interface and register the instance in `QUOTE_PROVIDERS`.
 * Routers only depend on this interface, never on a concrete API.
 */
export interface QuoteProvider {
  readonly id: QuoteSource;
  readonly label: string;
  getQuote(request: QuoteRequest): Promise<MarketQuote>;
}
