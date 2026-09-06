import {
  QUOTE_SOURCE_LABELS,
  type QuoteSource,
} from "@portifolio-tracker/shared";
import { ManualQuoteProvider } from "./manual";
import type { QuoteProvider } from "./provider";
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
