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
  /** Previous regular-session close, when exposed by the provider. */
  previousClose?: string;
  /** Calendar day of `previousClose`, when it can be resolved. */
  previousCloseAsOf?: string;
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

/** A daily-close range request, used to value many past snapshots at once. */
export type QuoteSeriesRequest = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  /** Inclusive `YYYY-MM-DD` range start. */
  start: string;
  /** Inclusive `YYYY-MM-DD` range end. */
  end: string;
  /** Required by the manual provider. */
  manualPrice?: string;
  /** Skip a completed provider cache entry while still sharing in-flight work. */
  forceRefresh?: boolean;
};

/** One native-currency close inside a historical series. */
export type QuoteSeriesPoint = {
  /** Calendar day of the close, `YYYY-MM-DD`. */
  asOf: string;
  /** Native-currency close, as a decimal string. */
  close: string;
};

/** Thrown when a provider has no price for a ticker (delisted, weekend gap, unsupported class). Routers catch this per ticker so one gap never fails a whole snapshot. */
export class QuoteUnavailableError extends Error {
  readonly ticker: string;
  /**
   * `true` when the failure says nothing about the symbol itself (timeout,
   * rate limit, provider outage). Only a non-transient failure may be cached:
   * retrying a transient one is the whole point of a user refresh.
   */
  readonly transient: boolean;

  constructor(
    ticker: string,
    message?: string,
    options?: { transient?: boolean },
  ) {
    super(message ?? `No quote available for ${ticker}`);
    this.name = "QuoteUnavailableError";
    this.ticker = ticker;
    this.transient = options?.transient ?? false;
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
  /**
   * Daily closes over a range, ascending and gap-free only on trading days.
   * Callers resolve a snapshot by taking the last close at or before the
   * snapshot day, so weekends and holidays need no special casing.
   */
  getSeries(request: QuoteSeriesRequest): Promise<QuoteSeriesPoint[]>;
}
