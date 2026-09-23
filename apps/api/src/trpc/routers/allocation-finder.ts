import type {
  ParsedDeepFinderInput,
  QuoteSource,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { assetCategories } from "../../db/schema";
import type { AllocationAssetMeta, WatchQuote } from "../../domain/allocation";
import { consolidatePositions, isOpenQuantity } from "../../domain/positions";
import { getQuoteProvider, getQuoteWithManualFallback } from "../../lib/quotes";
import { resolveUsdBrlRate } from "../fx-rate";
import { loadAssets } from "./allocation-data";
import { storedManualPrices } from "./allocation-helpers";
import { buildFinderResult, type FinderPosition } from "./deep-finder";
import { loadTransactionsForTickers } from "./transactions";

/** Quotes assets with no open position without failing the allocation table. */
export async function quoteWatchOnly(
  assets: readonly AllocationAssetMeta[],
  quoteSource: QuoteSource,
  manualPrices: Record<string, string>,
  forceRefresh = false,
): Promise<{
  quotes: Map<string, WatchQuote>;
  missing: string[];
  manual: string[];
}> {
  const provider = getQuoteProvider(quoteSource);
  const quotes = new Map<string, WatchQuote>();
  const missing: string[] = [];
  const manual: string[] = [];

  await Promise.all(
    assets.map(async (asset) => {
      try {
        const resolved = await getQuoteWithManualFallback(provider, {
          ticker: asset.ticker,
          assetClass: asset.assetClass,
          currency: asset.currency,
          manualPrice: manualPrices[asset.ticker],
          forceRefresh,
        });

        quotes.set(asset.ticker, {
          price: resolved.quote.price,
          currency: resolved.quote.currency,
        });
        if (resolved.manual) manual.push(asset.ticker);
      } catch {
        // One unpriced watch asset never fails the table.
        missing.push(asset.ticker);
      }
    }),
  );

  return { quotes, missing, manual };
}

export async function loadAllocationFinder(
  userId: string,
  input: ParsedDeepFinderInput & { categoryId?: string | null },
  forceSeriesRefresh = false,
) {
  const assets = await loadAssets(userId);
  const [assignments, history] = await Promise.all([
    db
      .select({
        ticker: assetCategories.ticker,
        categoryId: assetCategories.categoryId,
      })
      .from(assetCategories)
      .where(eq(assetCategories.userId, userId)),
    loadTransactionsForTickers(
      userId,
      assets.map((asset) => asset.ticker),
    ),
  ]);
  const categoryByTicker = new Map(
    assignments.map((row) => [row.ticker, row.categoryId]),
  );
  const invested = new Set(
    consolidatePositions(history)
      .filter((position) => isOpenQuantity(position.quantity))
      .map((position) => position.ticker),
  );
  const selected = assets.filter((asset) => {
    if (invested.has(asset.ticker)) return false;
    if (input.categoryId === undefined) return true;
    return (categoryByTicker.get(asset.ticker) ?? null) === input.categoryId;
  });

  const needsRate = selected.some(
    (asset) => asset.currency !== input.displayCurrency,
  );
  const usdBrlRate =
    needsRate && !input.usdBrlRate
      ? await resolveUsdBrlRate(input)
      : input.usdBrlRate;

  if (needsRate && !usdBrlRate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An USD/BRL rate is required to compare mixed currencies",
    });
  }

  const requestManuals = {
    ...storedManualPrices(selected),
    ...Object.fromEntries(
      Object.entries(input.manualPrices ?? {}).map(([ticker, price]) => [
        ticker.toUpperCase(),
        price,
      ]),
    ),
  };
  const positions: FinderPosition[] = selected.map((asset) => ({
    ticker: asset.ticker,
    assetClass: asset.assetClass,
    currency: asset.currency,
    quantity: "1",
    marketPrice: null,
    convertedMarketValue: null,
    convertedUnrealizedPnl: null,
    unrealizedPnlPercent: null,
  }));

  return buildFinderResult({
    positions,
    missing: [],
    input: { ...input, usdBrlRate, manualPrices: requestManuals },
    reuseSeriesAcrossWindows: true,
    deriveCurrentFromSeries: true,
    forceSeriesRefresh,
  });
}
