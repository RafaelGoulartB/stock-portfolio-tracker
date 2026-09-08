import { type FxSource, positiveDecimal } from "@portifolio-tracker/shared";
import { useMemo } from "react";
import { trpc } from "@/lib/api";
import { useSettings } from "@/lib/settings";

/**
 * The FX fields every portfolio query sends. The server resolves the rate
 * itself from these, so a screen no longer has to fetch `fx.getRate`, wait
 * for it, and only then ask for its portfolio.
 *
 * A manual rate is only sent once it parses, so an in-progress edit never
 * turns into a validation error on the request.
 */
export function useFxRequest(): { fxSource: FxSource; manualRate?: string } {
  const { fxSource, manualRate } = useSettings();
  const manualRateValid = positiveDecimal.safeParse(manualRate).success;

  return useMemo(
    () => ({
      fxSource,
      manualRate:
        fxSource === "manual" && manualRateValid ? manualRate : undefined,
    }),
    [fxSource, manualRate, manualRateValid],
  );
}

/**
 * USD/BRL quote for the portfolio display currency. Manual mode validates
 * the user's own rate; external sources are fetched once per snapshot day
 * and shared through the query cache (same key in the modal and the
 * positions page). `asOf` is a `YYYY-MM-DD` month-end close; omitted means
 * the live spot quote.
 *
 * Portfolio screens no longer depend on this to build their request; it backs
 * the rate readout and the FX error messaging.
 */
export function useFxQuote(asOf?: string | null) {
  const { fxSource, manualRate } = useSettings();
  const manualRateValid = positiveDecimal.safeParse(manualRate).success;

  const quote = trpc.fx.getRate.useQuery(
    {
      from: "USD",
      to: "BRL",
      source: fxSource,
      manualRate: manualRateValid ? manualRate : undefined,
      asOf: asOf ?? undefined,
    },
    {
      enabled: fxSource === "manual" ? manualRateValid : true,
      staleTime: 6 * 60 * 60 * 1_000,
      gcTime: 6 * 60 * 60 * 1_000,
    },
  );

  return {
    fxSource,
    manualRate,
    manualRateValid,
    /** Rate accepted by `positions.list`, if one is available. */
    effectiveRate:
      fxSource === "manual"
        ? manualRateValid
          ? manualRate
          : undefined
        : quote.data?.rate,
    rate: quote.data?.rate,
    asOf: quote.data?.asOf,
    isPending: quote.isPending || quote.isFetching,
    error: quote.error,
    refetch: quote.refetch,
  };
}
