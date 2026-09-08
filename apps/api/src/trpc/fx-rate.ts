import type { FxSource } from "@portifolio-tracker/shared";
import { getFxProvider } from "../lib/fx";

/** The FX part of a request that can be resolved without the client's help. */
export type UsdBrlRateRequest = {
  /** Explicit rate. When present it always wins. */
  usdBrlRate?: string;
  fxSource?: FxSource;
  /** Only meaningful when `fxSource` is `manual`. */
  manualRate?: string;
  /** `YYYY-MM-DD` close to price the rate at; omitted means latest spot. */
  asOf?: string;
};

/**
 * Resolves BRL per 1 USD for a request, mirroring what `performance.history`
 * already does with `fxSource`.
 *
 * Screens used to fetch `fx.getRate`, wait for it, and only then request their
 * portfolio: three serial round trips on a cold load, two of them hitting a
 * third party. Resolving here collapses that. The provider keeps its own
 * process cache, and `fx.getRate` is itself a procedure against the same
 * provider instance, so the displayed rate and the rate used to consolidate
 * are the same number, not two independent quotes.
 *
 * Returns `undefined` when no rate can be established. Callers keep raising
 * their own "a rate is required" error, so a portfolio that needs no
 * conversion is never blocked by an FX outage.
 */
export async function resolveUsdBrlRate(
  request: UsdBrlRateRequest,
): Promise<string | undefined> {
  if (request.usdBrlRate) {
    return request.usdBrlRate;
  }

  if (request.fxSource === "manual") {
    return request.manualRate;
  }

  const provider = getFxProvider(request.fxSource ?? "frankfurter");

  if (!provider) {
    return undefined;
  }

  try {
    const quote = await provider.getQuote({
      from: "USD",
      to: "BRL",
      asOf: request.asOf,
    });

    return quote.rate;
  } catch {
    // An unreachable FX provider must not turn into a wrong rate. The caller
    // reports "a rate is required" exactly as it did before.
    return undefined;
  }
}
