import { positiveDecimal } from "@portifolio-tracker/shared";
import { trpc } from "@/lib/api";
import { useSettings } from "@/lib/settings";

/**
 * USD/BRL quote for the portfolio display currency. Manual mode validates
 * the user's own rate; external sources are fetched once per snapshot day
 * and shared through the query cache (same key in the modal and the
 * positions page). `asOf` is a `YYYY-MM-DD` month-end close; omitted means
 * the live spot quote.
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
