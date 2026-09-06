import { formatDecimal, toDecimal } from "../decimal";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./provider";

type CacheEntry = { quote: FxQuote; expiresAt: number };

/** In-memory quotes with a TTL, so one page load costs one upstream call. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const cache = new Map<string, CacheEntry>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(
  provider: string,
  from: string,
  to: string,
  asOf?: string,
): string {
  return `${provider}|${from}->${to}|${asOf ?? "spot"}`;
}

/**
 * Free ECB-reference rates, no API key. Only USD/BRL pairs are requested by
 * this portfolio; anything else is derived through USD.
 *
 * Historical closes resolve through the dated endpoint (`/{YYYY-MM-DD}`),
 * which is what month snapshots consolidate with. ECB reference rates have
 * no weekend closes; Frankfurter carries the previous business day forward,
 * so the returned `asOf` is the effective quote day.
 */
export class FrankfurterProvider implements FxProvider {
  readonly id = "frankfurter" as const;
  readonly label = "Frankfurter (ECB reference)";

  async getQuote({ from, to, asOf }: FxQuoteRequest): Promise<FxQuote> {
    if (from === to) {
      return { from, to, rate: "1", asOf: asOf ?? todayUtc(), source: this.id };
    }

    const key = cacheKey(this.id, from, to, asOf);

    const hit = cache.get(key);

    if (hit && hit.expiresAt > Date.now()) {
      return hit.quote;
    }

    const endpoint = asOf ?? "latest";
    const response = await fetch(
      `https://api.frankfurter.app/${endpoint}?from=${from}&to=${to}`,
      { signal: AbortSignal.timeout(8_000) },
    );

    if (!response.ok) {
      throw new Error(`Frankfurter request failed (${response.status})`);
    }

    const body = (await response.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const raw = body.rates?.[to];

    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      throw new Error(`Frankfurter returned no ${from}->${to} rate`);
    }

    // Market quotes arrive as floats; stringify at the edge so every
    // downstream computation stays in fixed-point decimals.
    const quote: FxQuote = {
      from,
      to,
      rate: formatDecimal(toDecimal(String(raw)), 8),
      asOf: body.date ?? asOf ?? todayUtc(),
      source: this.id,
    };

    cache.set(key, { quote, expiresAt: Date.now() + CACHE_TTL_MS });

    return quote;
  }
}

/** Clears cached quotes. Exported for tests. */
export function clearFxCache(): void {
  cache.clear();
}
