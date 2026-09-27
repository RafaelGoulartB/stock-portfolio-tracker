import { positiveDecimal } from "@portifolio-tracker/shared";
import { useMemo } from "react";
import { useFxRequest } from "@/lib/fx";
import { useSettings } from "@/lib/settings";

/**
 * Input of `allocation.list` for the current settings. Every screen that
 * reads the allocation shares it, so they share one cached response.
 */
export function useAllocationListInput() {
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fxRequest = useFxRequest();

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );

  return useMemo(
    () => ({
      displayCurrency,
      ...fxRequest,
      quoteSource,
      manualPrices:
        quoteSource === "manual" &&
        Object.keys(sanitizedManualPrices).length > 0
          ? sanitizedManualPrices
          : undefined,
    }),
    [displayCurrency, fxRequest, quoteSource, sanitizedManualPrices],
  );
}
