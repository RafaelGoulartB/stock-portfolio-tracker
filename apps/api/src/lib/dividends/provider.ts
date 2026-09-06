import type { AssetClass, Currency } from "@portifolio-tracker/shared";

export type DividendProviderId = "yahoo" | "alpha_vantage";

export type DividendEvent = {
  id: string;
  ticker: string;
  currency: Currency;
  /** Native-currency cash amount per share, represented as a decimal string. */
  amountPerShare: string;
  declarationDate: string | null;
  exDate: string;
  recordDate: string | null;
  paymentDate: string | null;
  source: DividendProviderId;
};

export type DividendRequest = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  start: string;
  end: string;
};

export class DividendUnavailableError extends Error {
  readonly ticker: string;

  constructor(ticker: string, message?: string) {
    super(message ?? `No dividend data available for ${ticker}`);
    this.name = "DividendUnavailableError";
    this.ticker = ticker;
  }
}

/** Normalized contract shared by free and future paid dividend providers. */
export interface DividendProvider {
  readonly id: DividendProviderId;
  readonly label: string;
  getDividends(request: DividendRequest): Promise<DividendEvent[]>;
}
