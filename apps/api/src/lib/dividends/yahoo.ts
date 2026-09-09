import {
  clearQuoteCache,
  loadYahooChart,
  toYahooSymbol,
} from "../quotes/yahoo";
import {
  type DividendEvent,
  type DividendProvider,
  type DividendRequest,
  DividendUnavailableError,
} from "./provider";

/** Dividend events from the same cached Yahoo chart used for price history. */
export class YahooDividendProvider implements DividendProvider {
  readonly id = "yahoo" as const;
  readonly label = "Yahoo Finance (free)";

  async getDividends(request: DividendRequest): Promise<DividendEvent[]> {
    const symbol = toYahooSymbol(
      request.ticker,
      request.assetClass,
      request.currency,
    );

    if (!symbol) {
      throw new DividendUnavailableError(request.ticker);
    }

    try {
      const { dividends } = await loadYahooChart(
        symbol,
        request.ticker,
        request.start,
        request.end,
      );

      return dividends
        .map((event) => ({
          id: `yahoo:${symbol}:${event.exDate}:${event.amount}`,
          ticker: request.ticker,
          currency: request.currency,
          amountPerShare: event.amount,
          declarationDate: null,
          exDate: event.exDate,
          recordDate: null,
          paymentDate: null,
          source: this.id,
        }))
        .sort((a, b) => b.exDate.localeCompare(a.exDate));
    } catch (error) {
      throw new DividendUnavailableError(
        request.ticker,
        error instanceof Error ? error.message : "Yahoo request failed",
      );
    }
  }
}

export function clearYahooDividendCache(): void {
  clearQuoteCache();
}
