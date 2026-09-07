import type {
  Currency,
  Position,
  QuoteSource,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { allocationAssets, cashBalances } from "../db/schema";
import {
  type ConsolidationInput,
  consolidatePositions,
  convertPositions,
  filterTransactionsByAsOf,
  type ValuationQuote,
  valuePositions,
  withCashPosition,
} from "../domain/positions";
import {
  getQuoteProvider,
  getQuoteWithManualFallback,
  QuoteUnavailableError,
} from "../lib/quotes";
import { loadTransactions } from "./routers/transactions";

export type ValuationRequest = {
  userId: string;
  displayCurrency: Currency;
  /** Required whenever the portfolio mixes currencies. */
  usdBrlRate?: string;
  quoteSource: QuoteSource;
  /** Per-ticker native prices for the `manual` source, any casing. */
  manualPrices?: Record<string, string>;
  /** `YYYY-MM-DD` snapshot; omitted values the live portfolio. */
  asOf?: string;
};

export type ValuationResult = {
  /** The whole trade log, so callers can derive their own dates. */
  transactions: ConsolidationInput[];
  positions: ValuedPosition[];
  /** Tickers the provider had no price for, ascending. */
  missing: string[];
  /** Tickers valued from a stored/client manual price after the live quote failed. */
  manual: string[];
};

/** Stored native per-unit values used when a market provider cannot quote. */
export async function loadStoredManualPrices(
  userId: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({
      ticker: allocationAssets.ticker,
      manualPrice: allocationAssets.manualPrice,
    })
    .from(allocationAssets)
    .where(eq(allocationAssets.userId, userId));

  return Object.fromEntries(
    rows
      .filter((asset) => asset.manualPrice !== null)
      .map((asset) => [asset.ticker, asset.manualPrice as string]),
  );
}

/**
 * Consolidates the trade log, converts it into the display currency and
 * values every open position with the requested quote source. Shared by the
 * screens that need a valued portfolio (positions, allocation) so the
 * conversion and quote-failure rules live in one place.
 *
 * A ticker without a quote is reported in `missing` and keeps `null` market
 * fields; only a provider that fails for *every* ticker raises.
 */
export async function loadValuedPortfolio(
  request: ValuationRequest,
): Promise<ValuationResult> {
  const [transactions, storedManualPrices, cashRows] = await Promise.all([
    loadTransactions(request.userId),
    loadStoredManualPrices(request.userId),
    request.asOf
      ? Promise.resolve([])
      : db
          .select({ amount: cashBalances.amount })
          .from(cashBalances)
          .where(eq(cashBalances.userId, request.userId))
          .limit(1),
  ]);
  const native = consolidatePositions(
    filterTransactionsByAsOf(transactions, request.asOf ?? null),
  );
  const includeCash = request.asOf === undefined;
  const needsRate =
    native.some((position) => position.currency !== request.displayCurrency) ||
    (includeCash && request.displayCurrency !== "BRL");

  if (needsRate && !request.usdBrlRate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "An USD/BRL rate is required to consolidate mixed currencies",
    });
  }

  let converted: Position[];

  try {
    converted = convertPositions(
      native,
      request.displayCurrency,
      request.usdBrlRate ?? null,
    );
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The USD/BRL rate is invalid",
    });
  }

  const manualPrices = {
    ...storedManualPrices,
    ...Object.fromEntries(
      Object.entries(request.manualPrices ?? {}).map(([ticker, price]) => [
        ticker.toUpperCase(),
        price,
      ]),
    ),
  };
  const provider = getQuoteProvider(request.quoteSource);
  const quotes = new Map<string, ValuationQuote>();
  const missing: string[] = [];
  const manual: string[] = [];
  let providerFailures = 0;
  let lastProviderError: string | null = null;

  await Promise.all(
    converted.map(async (position) => {
      if (Number(position.quantity) === 0) {
        return;
      }

      try {
        const resolved = await getQuoteWithManualFallback(provider, {
          ticker: position.ticker,
          assetClass: position.assetClass,
          currency: position.currency,
          asOf: request.asOf,
          manualPrice: manualPrices[position.ticker],
        });

        quotes.set(position.ticker, {
          ticker: resolved.quote.ticker,
          price: resolved.quote.price,
          asOf: resolved.quote.asOf,
        });

        if (resolved.manual) {
          manual.push(position.ticker);
        }
      } catch (error) {
        missing.push(position.ticker);

        if (!(error instanceof QuoteUnavailableError)) {
          providerFailures += 1;
          lastProviderError =
            error instanceof Error ? error.message : "Quote provider failed";
        }
      }
    }),
  );

  if (quotes.size === 0 && providerFailures > 0) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: lastProviderError ?? "Quote provider failed",
    });
  }

  const valued = valuePositions(
    converted,
    quotes,
    request.displayCurrency,
    request.usdBrlRate ?? null,
  );

  return {
    transactions,
    positions: includeCash
      ? withCashPosition(
          valued,
          cashRows[0]?.amount ?? "0",
          request.displayCurrency,
          request.usdBrlRate ?? null,
        )
      : valued,
    missing: missing.sort(),
    manual: manual.sort(),
  };
}
