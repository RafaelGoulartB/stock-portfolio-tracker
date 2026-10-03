import { positiveDecimal } from "@portifolio-tracker/shared";
import { useMemo } from "react";
import { type StoredQuerySettings, useSettings } from "@/lib/settings";

/**
 * The settings part of every live portfolio query (`allocation.list`,
 * `positions.list`, `positions.daily`, `positions.finder`). A pure function so
 * route loaders and components build byte-identical inputs and therefore hit
 * the same cache entry.
 *
 * A manual rate is only sent once it parses, and manual prices only with the
 * manual quote source, so in-progress edits never become request errors.
 */
export function portfolioQueryInput(settings: StoredQuerySettings) {
  const manualRateValid = positiveDecimal.safeParse(
    settings.manualRate,
  ).success;
  const manualPrices = Object.fromEntries(
    Object.entries(settings.manualPrices).filter(
      ([, price]) => positiveDecimal.safeParse(price).success,
    ),
  );

  return {
    displayCurrency: settings.displayCurrency,
    fxSource: settings.fxSource,
    manualRate:
      settings.fxSource === "manual" && manualRateValid
        ? settings.manualRate
        : undefined,
    quoteSource: settings.quoteSource,
    manualPrices:
      settings.quoteSource === "manual" && Object.keys(manualPrices).length > 0
        ? manualPrices
        : undefined,
  };
}

/** Input of the one-month movers shown by the Positions teaser. */
export function monthMoversInput(
  portfolioInput: ReturnType<typeof portfolioQueryInput>,
) {
  return { ...portfolioInput, window: "1m" as const };
}

/** {@link portfolioQueryInput} for the current settings. */
export function usePortfolioQueryInput() {
  const { displayCurrency, fxSource, manualRate, quoteSource, manualPrices } =
    useSettings();

  return useMemo(
    () =>
      portfolioQueryInput({
        displayCurrency,
        fxSource,
        manualRate,
        quoteSource,
        manualPrices,
      }),
    [displayCurrency, fxSource, manualRate, quoteSource, manualPrices],
  );
}

/**
 * Input of `allocation.list` for the current settings. Every screen that
 * reads the allocation shares it, so they share one cached response.
 */
export const useAllocationListInput = usePortfolioQueryInput;
