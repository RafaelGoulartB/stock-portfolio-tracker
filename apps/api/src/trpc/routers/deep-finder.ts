import {
  type DeepFinderRow,
  deepFinderInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { seriesLookbackStart, windowStartDay } from "../../domain/deep-finder";
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
import { getQuoteProvider, QuoteUnavailableError } from "../../lib/quotes";
import { protectedProcedure } from "../trpc";
import { loadValuedPortfolio } from "../valuation";

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
    const asOf = today();
    const start = windowStartDay(input.window, asOf);

    const rows =
      input.window === "cost" || start === null
        ? costRows(open, input.displayCurrency)
        : await periodRows({
            positions: open,
            start,
            asOf,
            displayCurrency: input.displayCurrency,
            usdBrlRate: input.usdBrlRate ?? "1",
            quoteSource: input.quoteSource,
            manualPrices: input.manualPrices ?? {},
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
        ...portfolio.missing,
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
        openPositions: open.length,
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
  });

function costRows(
  positions: Awaited<ReturnType<typeof loadValuedPortfolio>>["positions"],
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
}: {
  positions: Awaited<ReturnType<typeof loadValuedPortfolio>>["positions"];
  start: string;
  asOf: string;
  displayCurrency: DeepFinderRow["displayCurrency"];
  usdBrlRate: string;
  quoteSource: Parameters<typeof getQuoteProvider>[0];
  manualPrices: Record<string, string>;
}): Promise<DeepFinderRow[]> {
  const provider = getQuoteProvider(quoteSource);
  const seriesStart = seriesLookbackStart(start);
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
        position.marketPrice == null ||
        position.convertedMarketValue == null
      ) {
        return base;
      }

      try {
        const series = await provider.getSeries({
          ticker: position.ticker,
          assetClass: position.assetClass,
          currency: position.currency,
          start: seriesStart,
          end: asOf,
          manualPrice: prices[position.ticker],
        });
        const lookup = createSeriesLookup(series);
        const baseline = lookup(start);

        if (!baseline) {
          return base;
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
        const change = sub(
          toDecimal(position.convertedMarketValue),
          toDecimal(startDisplay),
        );

        return {
          ...base,
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
