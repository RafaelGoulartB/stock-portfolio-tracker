import type { Currency, FxSource } from "@portifolio-tracker/shared";

/** A USD/BRL quote. `rate` is BRL per 1 USD as a decimal string. */
export type FxQuote = {
  from: Currency;
  to: Currency;
  rate: string;
  /** Calendar day the quote refers to, `YYYY-MM-DD`. */
  asOf: string;
  source: FxSource;
};

export type FxQuoteRequest = {
  from: Currency;
  to: Currency;
  /** `YYYY-MM-DD` close; omitted means the latest spot quote. */
  asOf?: string;
};

/** A dated-range request used to value many past snapshots at once. */
export type FxSeriesRequest = {
  from: Currency;
  to: Currency;
  /** Inclusive `YYYY-MM-DD` range start. */
  start: string;
  /** Inclusive `YYYY-MM-DD` range end. */
  end: string;
};

/** One dated rate inside a historical series. */
export type FxSeriesPoint = {
  asOf: string;
  /** BRL per 1 USD, as a decimal string. */
  rate: string;
};

/**
 * Quote source contract. To add a new source (BCB PTAX, open.er-api, ...),
 * implement this interface and register the instance in `FX_PROVIDERS`.
 * Routers only depend on this interface, never on a concrete API.
 */
export interface FxProvider {
  readonly id: FxSource;
  readonly label: string;
  getQuote(request: FxQuoteRequest): Promise<FxQuote>;
  /**
   * Dated rates over a range, ascending. Business days only; callers take
   * the last rate at or before the day they need.
   */
  getSeries(request: FxSeriesRequest): Promise<FxSeriesPoint[]>;
}
