import {
  type DeepFinderRow,
  deepFinderInput,
  type ParsedDeepFinderInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  finderSeriesStart,
  seriesLookbackStart,
  windowStartDay,
} from "../../domain/deep-finder";
import { createSeriesLookup } from "../../domain/performance";
import { convertMoney } from "../../domain/positions";
import {
  add,
  div,
  formatDecimal,
  isZero,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import {
  getQuoteProvider,
  getSeriesWithManualFallback,
  QuoteUnavailableError,
} from "../../lib/quotes";
import { protectedProcedure } from "../trpc";
import { loadValuedPortfolio } from "../valuation";

export type FinderPosition = {
  ticker: string;
  assetClass: DeepFinderRow["assetClass"];
  currency: DeepFinderRow["currency"];
  quantity: string;
  marketPrice: string | null;
  convertedMarketValue: string | null;
  convertedUnrealizedPnl: string | null;
  unrealizedPnlPercent: string | null;
};

const API_TIME_ZONE = "America/Sao_Paulo";
const MONEY_PLACES = 2;
const RATE_PLACES = 8;

function today(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: API_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Open holdings ranked by how they moved: versus cost, or versus a past
 * close. One ticker without a baseline never fails the rest of the book.
 */
export const finder = protectedProcedure
  .input(deepFinderInput)
  .query(async ({ ctx, input }) => {
    const portfolio = await loadValuedPortfolio({
      userId: ctx.user.id,
      displayCurrency: input.displayCurrency,
      usdBrlRate: input.usdBrlRate,
      quoteSource: input.quoteSource,
      manualPrices: input.manualPrices,
    });
    const open = portfolio.positions.filter(
      (position) => Number(position.quantity) > 0,
    );
    return buildFinderResult({
      positions: open,
      missing: portfolio.missing,
      input,
    });
  });

/** Shared calculation used by the portfolio and allocation-watchlist finders. */
export async function buildFinderResult({
  positions,
  missing: quoteMissing,
  input,
  reuseSeriesAcrossWindows = false,
  deriveCurrentFromSeries = false,
  forceSeriesRefresh = false,
}: {
  positions: FinderPosition[];
  missing: string[];
  input: ParsedDeepFinderInput;
  /** Fetch one stable one-year range so every period reuses the provider cache. */
  reuseSeriesAcrossWindows?: boolean;
  /** Use the newest close as the current quote, avoiding a second provider call. */
  deriveCurrentFromSeries?: boolean;
  /** Explicit user refresh that replaces completed provider cache entries. */
  forceSeriesRefresh?: boolean;
}) {
  const asOf = today();
  const start = windowStartDay(input.window, asOf);
  const seriesStart = reuseSeriesAcrossWindows
    ? (finderSeriesStart(input.window, asOf, true) ?? undefined)
    : undefined;

  const rows =
    input.window === "cost" || start === null
      ? costRows(positions, input.displayCurrency)
      : await periodRows({
          positions,
          start,
          asOf,
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate ?? "1",
          quoteSource: input.quoteSource,
          manualPrices: input.manualPrices ?? {},
          seriesStart,
          deriveCurrentFromSeries,
          forceSeriesRefresh,
        });

  const comparable = rows.filter((row) => row.change !== null);
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;
  let totalChange = ZERO;
  let totalBaseline = ZERO;

  for (const row of comparable) {
    const change = toDecimal(row.change ?? "0");
    totalChange = add(totalChange, change);

    if (row.changePercent !== null && row.marketValue !== null) {
      const market = toDecimal(row.marketValue);
      totalBaseline = add(totalBaseline, sub(market, change));
    }

    if (change > ZERO) {
      advancing += 1;
    } else if (change < ZERO) {
      declining += 1;
    } else {
      unchanged += 1;
    }
  }

  comparable.sort((a, b) => {
    const leftMissing = a.changePercent == null;
    const rightMissing = b.changePercent == null;

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        return a.ticker.localeCompare(b.ticker);
      }

      return leftMissing ? 1 : -1;
    }

    return Number(b.changePercent) - Number(a.changePercent);
  });
  const missing = [
    ...new Set([
      ...quoteMissing,
      ...rows.filter((row) => row.change === null).map((row) => row.ticker),
    ]),
  ].sort();

  return {
    window: input.window,
    windowStart: start,
    asOf,
    positions: [
      ...comparable,
      ...rows
        .filter((row) => row.change === null)
        .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    ],
    summary: {
      displayCurrency: input.displayCurrency,
      advancing,
      declining,
      unchanged,
      comparable: comparable.length,
      openPositions: positions.length,
      totalChange: formatDecimal(totalChange, MONEY_PLACES),
      totalChangePercent: isZero(totalBaseline)
        ? null
        : formatDecimal(div(totalChange, totalBaseline), RATE_PLACES),
      usdBrlRate: input.usdBrlRate ?? null,
    },
    quotes: {
      source: input.quoteSource,
      missing,
    },
  };
}

function costRows(
  positions: FinderPosition[],
  displayCurrency: DeepFinderRow["displayCurrency"],
): DeepFinderRow[] {
  return positions.map((position) => ({
    ticker: position.ticker,
    assetClass: position.assetClass,
    currency: position.currency,
    displayCurrency,
    quantity: position.quantity,
    marketValue: position.convertedMarketValue,
    change: position.convertedUnrealizedPnl,
    changePercent: position.unrealizedPnlPercent,
    baselinePrice: null,
    baselineAsOf: null,
    marketPrice: position.marketPrice,
  }));
}

async function periodRows({
  positions,
  start,
  asOf,
  displayCurrency,
  usdBrlRate,
  quoteSource,
  manualPrices,
  seriesStart,
  deriveCurrentFromSeries,
  forceSeriesRefresh,
}: {
  positions: FinderPosition[];
  start: string;
  asOf: string;
  displayCurrency: DeepFinderRow["displayCurrency"];
  usdBrlRate: string;
  quoteSource: Parameters<typeof getQuoteProvider>[0];
  manualPrices: Record<string, string>;
  seriesStart?: string;
  deriveCurrentFromSeries: boolean;
  forceSeriesRefresh: boolean;
}): Promise<DeepFinderRow[]> {
  const provider = getQuoteProvider(quoteSource);
  const requestStart = seriesStart ?? seriesLookbackStart(start);
  const prices = Object.fromEntries(
    Object.entries(manualPrices).map(([ticker, price]) => [
      ticker.toUpperCase(),
      price,
    ]),
  );

  return Promise.all(
    positions.map(async (position): Promise<DeepFinderRow> => {
      const base: DeepFinderRow = {
        ticker: position.ticker,
        assetClass: position.assetClass,
        currency: position.currency,
        displayCurrency,
        quantity: position.quantity,
        marketValue: position.convertedMarketValue,
        change: null,
        changePercent: null,
        baselinePrice: null,
        baselineAsOf: null,
        marketPrice: position.marketPrice,
      };

      if (
        !deriveCurrentFromSeries &&
        (position.marketPrice == null || position.convertedMarketValue == null)
      ) {
        return base;
      }

      try {
        const { points: series } = await getSeriesWithManualFallback(provider, {
          ticker: position.ticker,
          assetClass: position.assetClass,
          currency: position.currency,
          start: requestStart,
          end: asOf,
          manualPrice: prices[position.ticker],
          forceRefresh: forceSeriesRefresh,
        });
        const lookup = createSeriesLookup(series);
        const baseline = lookup(start);
        const latest = deriveCurrentFromSeries ? lookup(asOf) : null;
        const marketPrice = position.marketPrice ?? latest?.close ?? null;
        const marketValue =
          position.convertedMarketValue ??
          (marketPrice === null
            ? null
            : convertMoney(
                formatDecimal(
                  mul(toDecimal(position.quantity), toDecimal(marketPrice)),
                  MONEY_PLACES,
                ),
                position.currency,
                displayCurrency,
                usdBrlRate,
              ));
        const resolvedBase = { ...base, marketPrice, marketValue };

        if (!baseline || marketPrice === null || marketValue === null) {
          return resolvedBase;
        }

        const startNative = mul(
          toDecimal(position.quantity),
          toDecimal(baseline.close),
        );

        if (isZero(startNative)) {
          return base;
        }

        const startDisplay = convertMoney(
          formatDecimal(startNative, MONEY_PLACES),
          position.currency,
          displayCurrency,
          usdBrlRate,
        );
        const change = sub(toDecimal(marketValue), toDecimal(startDisplay));

        return {
          ...resolvedBase,
          change: formatDecimal(change, MONEY_PLACES),
          changePercent: formatDecimal(
            div(change, toDecimal(startDisplay)),
            RATE_PLACES,
          ),
          baselinePrice: baseline.close,
          baselineAsOf: baseline.asOf,
        };
      } catch (error) {
        if (error instanceof QuoteUnavailableError) {
          return base;
        }

        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            error instanceof Error ? error.message : "Quote provider failed",
        });
      }
    }),
  );
}
