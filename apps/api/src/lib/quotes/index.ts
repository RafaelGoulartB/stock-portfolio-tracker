import {
  QUOTE_SOURCE_LABELS,
  type QuoteSource,
} from "@portifolio-tracker/shared";
import { ManualQuoteProvider } from "./manual";
import type { MarketQuote, QuoteProvider, QuoteRequest } from "./provider";
import { QuoteUnavailableError } from "./provider";
import { YahooProvider } from "./yahoo";

export { ManualQuoteProvider } from "./manual";
export type {
  MarketQuote,
  QuoteProvider,
  QuoteRequest,
  QuoteSeriesPoint,
  QuoteSeriesRequest,
} from "./provider";
export { QuoteUnavailableError } from "./provider";
export { clearQuoteCache, YahooProvider } from "./yahoo";

/**
 * Registry of market-quote sources. Adding a source means implementing
 * `QuoteProvider` and adding one line here; the quotes router and the web
 * source selector pick it up automatically.
 */
export const QUOTE_PROVIDERS: Record<QuoteSource, QuoteProvider> = {
  yahoo: new YahooProvider(),
  manual: new ManualQuoteProvider(),
};

export function listQuoteSources(): { id: QuoteSource; label: string }[] {
  return (Object.keys(QUOTE_PROVIDERS) as QuoteSource[]).map((id) => ({
    id,
    label: QUOTE_SOURCE_LABELS[id],
  }));
}

export function getQuoteProvider(source: QuoteSource): QuoteProvider {
  return QUOTE_PROVIDERS[source];
}

const manualFallback = new ManualQuoteProvider();

/**
 * Tries the selected provider, then a stored per-ticker price if the live
 * quote is missing. The rest of the app keeps using spot prices; this is
 * only a valuation fallback for assets without a public quote.
 */
export async function getQuoteWithManualFallback(
  provider: QuoteProvider,
  request: QuoteRequest,
): Promise<{ quote: MarketQuote; manual: boolean }> {
  try {
    return { quote: await provider.getQuote(request), manual: false };
  } catch (error) {
    if (!(error instanceof QuoteUnavailableError) || !request.manualPrice) {
      throw error;
    }

    return { quote: await manualFallback.getQuote(request), manual: true };
  }
}
