import type { DividendSource } from "@portifolio-tracker/shared";
import { env } from "../../env";
import { AlphaVantageDividendProvider } from "./alpha-vantage";
import type {
  DividendEvent,
  DividendProvider,
  DividendRequest,
} from "./provider";
import { DividendUnavailableError } from "./provider";
import { YahooDividendProvider } from "./yahoo";

export type {
  DividendEvent,
  DividendProvider,
  DividendProviderId,
  DividendRequest,
} from "./provider";
export { DividendUnavailableError } from "./provider";

const yahoo = new YahooDividendProvider();
const alphaVantage = new AlphaVantageDividendProvider(
  env.ALPHA_VANTAGE_API_KEY,
);

/**
 * Enriches US events with Alpha Vantage payment dates when configured, while
 * retaining Yahoo as a zero-configuration fallback. Duplicate ex-date/amount
 * pairs prefer Alpha Vantage because it exposes the richer calendar fields.
 */
class AutomaticDividendProvider implements DividendProvider {
  readonly id = "yahoo" as const;
  readonly label = "Automatic (Alpha Vantage + Yahoo fallback)";

  async getDividends(request: DividendRequest): Promise<DividendEvent[]> {
    const providers: DividendProvider[] = env.ALPHA_VANTAGE_API_KEY
      ? [alphaVantage, yahoo]
      : [yahoo];
    const results = await Promise.allSettled(
      providers.map((provider) => provider.getDividends(request)),
    );
    const successful = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );

    if (results.every((result) => result.status === "rejected")) {
      const first = results[0];
      throw first?.status === "rejected"
        ? first.reason
        : new DividendUnavailableError(request.ticker);
    }

    const merged = new Map<string, DividendEvent>();

    // Yahoo enters first; richer Alpha events overwrite matching entries.
    for (const event of successful.sort((a, b) =>
      b.source.localeCompare(a.source),
    )) {
      merged.set(`${event.exDate}|${event.amountPerShare}`, event);
    }

    return [...merged.values()].sort((a, b) =>
      b.exDate.localeCompare(a.exDate),
    );
  }
}

const automatic = new AutomaticDividendProvider();

export const DIVIDEND_PROVIDERS: Record<DividendSource, DividendProvider> = {
  auto: automatic,
  yahoo,
  alpha_vantage: alphaVantage,
};

export function getDividendProvider(source: DividendSource): DividendProvider {
  return DIVIDEND_PROVIDERS[source];
}

export function hasAlphaVantageKey(): boolean {
  return Boolean(env.ALPHA_VANTAGE_API_KEY);
}
