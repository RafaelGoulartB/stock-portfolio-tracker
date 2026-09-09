import {
  dailyTrackingInput,
  positionsListInput,
} from "@portifolio-tracker/shared";
import {
  convertMoney,
  isOpenQuantity,
  portfolioReturnContribution,
  summarizePositions,
} from "../../domain/positions";
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
import { protectedProcedure, router } from "../trpc";
import { loadValuedPortfolio } from "../valuation";
import { finder } from "./deep-finder";

const API_TIME_ZONE = "America/Sao_Paulo";

/** Weekends show the latest completed common market session (Friday). */
function dailySnapshotDate(now = new Date()): string | undefined {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: API_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const weekday = value("weekday");

  if (weekday !== "Sat" && weekday !== "Sun") {
    return undefined;
  }

  const date = new Date(
    Date.UTC(
      Number(value("year")),
      Number(value("month")) - 1,
      Number(value("day")),
    ),
  );
  date.setUTCDate(date.getUTCDate() - (weekday === "Sat" ? 1 : 2));

  return date.toISOString().slice(0, 10);
}

export const positionsRouter = router({
  list: protectedProcedure
    .input(positionsListInput)
    .query(async ({ ctx, input }) => {
      const { positions, missing, usdBrlRate } = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        fxSource: input.fxSource,
        manualRate: input.manualRate,
        quoteSource: input.quoteSource,
        manualPrices: input.manualPrices,
        asOf: input.asOf,
        forceRefresh: input.forceRefresh,
      });

      const summary = summarizePositions(
        positions,
        input.displayCurrency,
        usdBrlRate,
        input.asOf ?? null,
      );

      return {
        positions: positions.map((position) => {
          return {
            ...position,
            returnContribution: portfolioReturnContribution(
              position.convertedUnrealizedPnl,
              summary.quotedInvestedCost,
            ),
          };
        }),
        summary,
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate,
        },
        quotes: {
          source: input.quoteSource,
          asOf: input.asOf ?? null,
          missing,
        },
      };
    }),
  daily: protectedProcedure
    .input(dailyTrackingInput)
    .query(async ({ ctx, input }) => {
      const snapshotDate = dailySnapshotDate();
      const {
        positions: valued,
        missing,
        usdBrlRate,
        quotes,
      } = await loadValuedPortfolio({
        userId: ctx.user.id,
        displayCurrency: input.displayCurrency,
        usdBrlRate: input.usdBrlRate,
        fxSource: input.fxSource,
        manualRate: input.manualRate,
        quoteSource: input.quoteSource,
        manualPrices: input.manualPrices,
        asOf: snapshotDate,
        includeCash: true,
        forceRefresh: input.forceRefresh,
      });
      const open = valued.filter((position) =>
        isOpenQuantity(position.quantity),
      );

      let previousComparableValue = ZERO;
      let currentComparableValue = ZERO;
      let advancing = 0;
      let declining = 0;
      let unchanged = 0;

      const positions = open.map((position) => {
        const quote = quotes.get(position.ticker);

        if (!quote?.previousClose || position.convertedMarketValue == null) {
          return {
            ...position,
            previousClose: null,
            previousCloseAsOf: null,
            convertedPreviousMarketValue: null,
            dailyChange: null,
            dailyChangePercent: null,
          };
        }

        const previousNativeValue = formatDecimal(
          mul(toDecimal(position.quantity), toDecimal(quote.previousClose)),
          2,
        );
        const convertedPreviousMarketValue = convertMoney(
          previousNativeValue,
          position.currency,
          input.displayCurrency,
          usdBrlRate ?? "1",
        );
        const change = sub(
          toDecimal(position.convertedMarketValue),
          toDecimal(convertedPreviousMarketValue),
        );
        const dailyChange = formatDecimal(change, 2);
        const previousValue = toDecimal(convertedPreviousMarketValue);

        previousComparableValue = add(previousComparableValue, previousValue);
        currentComparableValue = add(
          currentComparableValue,
          toDecimal(position.convertedMarketValue),
        );

        if (change > ZERO) {
          advancing += 1;
        } else if (change < ZERO) {
          declining += 1;
        } else {
          unchanged += 1;
        }

        return {
          ...position,
          previousClose: quote.previousClose,
          previousCloseAsOf: quote.previousCloseAsOf ?? null,
          convertedPreviousMarketValue,
          dailyChange,
          dailyChangePercent: isZero(previousValue)
            ? null
            : formatDecimal(div(change, previousValue), 8),
        };
      });

      const dailyChange = sub(currentComparableValue, previousComparableValue);
      const portfolio = summarizePositions(
        open,
        input.displayCurrency,
        usdBrlRate ?? null,
      );
      const quoteDates = [...quotes.values()].map((quote) => quote.asOf).sort();

      return {
        positions,
        summary: {
          displayCurrency: input.displayCurrency,
          marketValue: portfolio.totalMarketValue,
          previousComparableValue: formatDecimal(previousComparableValue, 2),
          currentComparableValue: formatDecimal(currentComparableValue, 2),
          dailyChange: formatDecimal(dailyChange, 2),
          dailyChangePercent: isZero(previousComparableValue)
            ? null
            : formatDecimal(div(dailyChange, previousComparableValue), 8),
          advancing,
          declining,
          unchanged,
          comparablePositions: advancing + declining + unchanged,
          openPositions: open.length,
          asOf: quoteDates.at(-1) ?? null,
          usdBrlRate: usdBrlRate ?? null,
        },
        quotes: {
          source: input.quoteSource,
          missing,
        },
      };
    }),

  /**
   * Open holdings ranked by a chosen window: cost basis, or a past close.
   * The crowded bar chart on Positions lives here so every ticker has room.
   */
  finder,
});
