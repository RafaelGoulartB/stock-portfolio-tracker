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

/**
 * Quote source contract. To add a new source (BCB PTAX, open.er-api, ...),
 * implement this interface and register the instance in `FX_PROVIDERS`.
 * Routers only depend on this interface, never on a concrete API.
 */
export interface FxProvider {
  readonly id: FxSource;
  readonly label: string;
  getQuote(request: FxQuoteRequest): Promise<FxQuote>;
}
