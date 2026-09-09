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
 * Merges providers in priority order. Calls stay sequential to protect the
 * Alpha Vantage quota, while Yahoo fills empty and partial primary results.
 * Duplicate ex-date/amount pairs retain the richer higher-priority event.
 */
export async function firstSuccessfulDividends(
  request: DividendRequest,
  providers: readonly DividendProvider[],
): Promise<DividendEvent[]> {
  let lastError: unknown;
  let succeeded = false;
  const merged = new Map<string, DividendEvent>();

  for (const provider of providers) {
    try {
      const events = await provider.getDividends(request);
      succeeded = true;
      for (const event of events) {
        const key = `${event.exDate}|${event.amountPerShare}`;
        if (!merged.has(key)) {
          merged.set(key, event);
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (succeeded) {
    return [...merged.values()].sort((a, b) =>
      b.exDate.localeCompare(a.exDate),
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new DividendUnavailableError(request.ticker);
}

class AutomaticDividendProvider implements DividendProvider {
  readonly id = "yahoo" as const;
  readonly label = "Automatic (Alpha Vantage + Yahoo fallback)";

  async getDividends(request: DividendRequest): Promise<DividendEvent[]> {
    const useAlphaVantage =
      Boolean(env.ALPHA_VANTAGE_API_KEY) &&
      request.currency === "USD" &&
      request.assetClass !== "stock_br";
    const providers: DividendProvider[] = useAlphaVantage
      ? [alphaVantage, yahoo]
      : [yahoo];

    return firstSuccessfulDividends(request, providers);
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
