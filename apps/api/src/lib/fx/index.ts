import { FX_SOURCE_LABELS, type FxSource } from "@portifolio-tracker/shared";
import { FrankfurterProvider } from "./frankfurter";
import type { FxProvider } from "./provider";

export { clearFxCache } from "./frankfurter";
export type {
  FxProvider,
  FxQuote,
  FxQuoteRequest,
  FxSeriesPoint,
  FxSeriesRequest,
} from "./provider";

/**
 * Registry of quote sources. Adding a source means implementing
 * `FxProvider` and adding one line here; the fx router and the web
 * source selector pick it up automatically.
 */
export const FX_PROVIDERS: Record<FxSource, FxProvider | null> = {
  frankfurter: new FrankfurterProvider(),
  // `manual` is resolved by the router from the user's own rate, so it has
  // no provider instance.
  manual: null,
};

export function listFxSources(): { id: FxSource; label: string }[] {
  return (Object.keys(FX_PROVIDERS) as FxSource[]).map((id) => ({
    id,
    label: FX_SOURCE_LABELS[id],
  }));
}

export function getFxProvider(source: FxSource): FxProvider | null {
  return FX_PROVIDERS[source];
}
