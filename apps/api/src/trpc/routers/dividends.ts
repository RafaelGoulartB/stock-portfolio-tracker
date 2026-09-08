import {
  type AssetClass,
  type Currency,
  dividendHistoryInput,
} from "@portifolio-tracker/shared";
import {
  attachDividendEntitlements,
  nativeDividendTotals,
} from "../../domain/dividends";
import { convertMoney } from "../../domain/positions";
import { add, formatDecimal, toDecimal, ZERO } from "../../lib/decimal";
import { getDividendProvider, hasAlphaVantageKey } from "../../lib/dividends";
import { resolveUsdBrlRate } from "../fx-rate";
import { protectedProcedure, router } from "../trpc";
import { loadTransactions } from "./transactions";

type DividendAsset = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
};

const DIVIDEND_ASSET_CLASSES = new Set<AssetClass>([
  "stock_br",
  "stock_us",
  "reit",
  "etf",
  "bdr",
]);

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftYears(day: string, years: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year + years, month - 1, date))
    .toISOString()
    .slice(0, 10);
}

export const dividendsRouter = router({
  history: protectedProcedure
    .input(dividendHistoryInput)
    .query(async ({ ctx, input }) => {
      const transactions = await loadTransactions(ctx.user.id);
      const assets = new Map<string, DividendAsset>();

      for (const transaction of transactions) {
        if (!DIVIDEND_ASSET_CLASSES.has(transaction.assetClass)) {
          continue;
        }

        assets.set(`${transaction.ticker}|${transaction.currency}`, {
          ticker: transaction.ticker,
          assetClass: transaction.assetClass,
          currency: transaction.currency,
        });
      }

      const today = todayInSaoPaulo();
      const start = shiftYears(today, -input.years);
      const end = shiftYears(today, 1);
      const provider = getDividendProvider(input.source);
      const missing: string[] = [];
      const rawEvents = (
        await Promise.all(
          [...assets.values()].map(async (asset) => {
            try {
              return await provider.getDividends({ ...asset, start, end });
            } catch {
              missing.push(asset.ticker);
              return [];
            }
          }),
        )
      ).flat();
      const entitled = attachDividendEntitlements(
        rawEvents,
        transactions,
        today,
      ).sort((a, b) => {
        const left = a.paymentDate ?? a.exDate;
        const right = b.paymentDate ?? b.exDate;
        return right.localeCompare(left) || a.ticker.localeCompare(b.ticker);
      });

      let convertedTotal = ZERO;
      let convertedUpcoming = ZERO;
      let unconvertedEvents = 0;
      // Income only needs a rate when an event is not already in the display
      // currency, so a single-currency book issues no FX request.
      const needsRate = entitled.some(
        (event) => event.currency !== input.displayCurrency,
      );
      const usdBrlRate =
        needsRate && !input.usdBrlRate
          ? await resolveUsdBrlRate(input)
          : input.usdBrlRate;
      const enriched = entitled.map((event) => {
        const convertedGrossAmount =
          event.currency === input.displayCurrency
            ? event.grossAmount
            : usdBrlRate
              ? convertMoney(
                  event.grossAmount,
                  event.currency,
                  input.displayCurrency,
                  usdBrlRate,
                )
              : null;

        if (convertedGrossAmount == null) {
          unconvertedEvents += 1;
        } else {
          convertedTotal = add(convertedTotal, toDecimal(convertedGrossAmount));
          if (event.status !== "estimated_paid") {
            convertedUpcoming = add(
              convertedUpcoming,
              toDecimal(convertedGrossAmount),
            );
          }
        }

        return { ...event, convertedGrossAmount };
      });

      const byMonth = new Map<string, bigint>();

      for (const event of enriched) {
        if (event.convertedGrossAmount == null) {
          continue;
        }
        const month = (event.paymentDate ?? event.exDate).slice(0, 7);
        byMonth.set(
          month,
          (byMonth.get(month) ?? ZERO) + toDecimal(event.convertedGrossAmount),
        );
      }

      const upcoming = enriched
        .filter((event) => event.status !== "estimated_paid")
        .sort((a, b) =>
          (a.paymentDate ?? a.exDate).localeCompare(b.paymentDate ?? b.exDate),
        );

      return {
        events: enriched,
        monthly: [...byMonth.entries()]
          .map(([month, amount]) => ({
            month,
            amount: formatDecimal(amount, 2),
          }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        summary: {
          displayCurrency: input.displayCurrency,
          convertedTotal: formatDecimal(convertedTotal, 2),
          convertedUpcoming: formatDecimal(convertedUpcoming, 2),
          eventCount: enriched.length,
          upcomingCount: upcoming.length,
          nextPaymentDate:
            upcoming[0]?.paymentDate ?? upcoming[0]?.exDate ?? null,
          nativeTotals: nativeDividendTotals(entitled),
          unconvertedEvents,
        },
        provider: {
          requested: input.source,
          alphaVantageConfigured: hasAlphaVantageKey(),
          missing: [...new Set(missing)].sort(),
        },
        range: { start, end, today },
      };
    }),
});
