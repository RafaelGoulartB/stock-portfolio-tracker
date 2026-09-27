import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { loadYahooChart, toYahooSymbol } from "../quotes/yahoo";

export type PublishedSplit = {
  effectiveAt: string;
  fromQuantity: string;
  toQuantity: string;
};

/**
 * Splits Yahoo published for a ticker inside a range, read from the same
 * cached chart used for prices. They are only *suggestions*: the ledger
 * changes solely when the user records one, so positions never depend on
 * this provider being reachable. Throws when Yahoo cannot answer.
 */
export async function yahooPublishedSplits(request: {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  start: string;
  end: string;
}): Promise<PublishedSplit[]> {
  const symbol = toYahooSymbol(
    request.ticker,
    request.assetClass,
    request.currency,
  );

  if (!symbol) {
    return [];
  }

  const { splits } = await loadYahooChart(
    symbol,
    request.ticker,
    request.start,
    request.end,
  );

  return splits.map((split) => ({
    effectiveAt: split.effectiveAt,
    fromQuantity: split.from,
    toQuantity: split.to,
  }));
}
