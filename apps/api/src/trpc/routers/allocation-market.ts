import {
  type AssetClass,
  CASH_TICKER,
  type Currency,
  DEFAULT_SCORE_CONFIG,
  type QuoteSource,
  quarterEndDate,
  type ScoreConfig,
  type ValuationSkill,
} from "@portifolio-tracker/shared";
import {
  type ClosePoint,
  type FairValueReview,
  momentum12to1,
  referencePrice,
  skillObservations,
  valuationSkill,
} from "../../domain/valuation-skill";
import { createConcurrencyLimiter } from "../../lib/async";
import { getQuoteProvider, QuoteUnavailableError } from "../../lib/quotes";
import { monthsAgo } from "./allocation-helpers";

/** Series the allocation screen may fetch at once; the provider caches them. */
const SERIES_CONCURRENCY = 6;
/** 12-1 momentum needs a year back; one extra month absorbs holidays. */
const MOMENTUM_LOOKBACK_MONTHS = 13;

export type MarketSignalAsset = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  targetWeight: string | null;
};

export type MarketSignals = {
  /** 12-1 month log return per ticker, only where a year of prices exists. */
  momentumByTicker: Map<string, string>;
  /** Quarter-end close per `ticker|period` fair value review. */
  referencePrices: Map<string, string>;
  skill: ValuationSkill;
  /** Tickers whose price history could not be loaded. */
  unavailable: string[];
};

/**
 * Loads the price history behind the score's market signals: momentum for
 * targeted assets, and quarter-end plus 12-month-later closes for every fair
 * value review (the valuation track record). History is never stored; the
 * quote provider's series cache keeps repeat loads cheap. A ticker whose
 * history fails simply has no signal, which the score treats as neutral.
 */
export async function loadMarketSignals(input: {
  assets: readonly MarketSignalAsset[];
  reviews: readonly FairValueReview[];
  today: string;
  quoteSource: QuoteSource;
  forceRefresh?: boolean;
  config?: ScoreConfig;
}): Promise<MarketSignals> {
  const config = input.config ?? DEFAULT_SCORE_CONFIG;
  const provider = getQuoteProvider(input.quoteSource);
  const byTicker = new Map(input.assets.map((asset) => [asset.ticker, asset]));
  const reviewed = new Set(input.reviews.map((review) => review.ticker));
  const tickers = input.assets
    .filter(
      (asset) =>
        asset.ticker !== CASH_TICKER &&
        asset.assetClass !== "cash" &&
        asset.assetClass !== "fixed_income" &&
        (asset.targetWeight !== null || reviewed.has(asset.ticker)),
    )
    .map((asset) => asset.ticker);

  const earliestReview = input.reviews.reduce<string | null>(
    (earliest, review) => {
      const end = quarterEndDate(review.period);
      return earliest === null || end < earliest ? end : earliest;
    },
    null,
  );
  const momentumStart = monthsAgo(input.today, MOMENTUM_LOOKBACK_MONTHS);
  const start =
    earliestReview !== null && earliestReview < momentumStart
      ? earliestReview
      : momentumStart;
  const limit = createConcurrencyLimiter(SERIES_CONCURRENCY);
  const seriesByTicker = new Map<string, ClosePoint[]>();
  const unavailable: string[] = [];

  await Promise.all(
    tickers.map((ticker) =>
      limit(async () => {
        const asset = byTicker.get(ticker);
        if (!asset) return;

        try {
          const points = await provider.getSeries({
            ticker,
            assetClass: asset.assetClass,
            currency: asset.currency,
            start,
            end: input.today,
            forceRefresh: input.forceRefresh,
          });
          seriesByTicker.set(ticker, points);
        } catch (error) {
          if (!(error instanceof QuoteUnavailableError)) {
            console.warn(`Price history failed for ${ticker}`, error);
          }
          unavailable.push(ticker);
        }
      }),
    ),
  );

  const momentumByTicker = new Map<string, string>();
  for (const [ticker, points] of seriesByTicker) {
    const value = momentum12to1(points, input.today);
    if (value !== null) momentumByTicker.set(ticker, value);
  }

  const referencePrices = new Map<string, string>();
  for (const review of input.reviews) {
    const points = seriesByTicker.get(review.ticker);
    if (!points) continue;
    const price = referencePrice(points, review.period);
    if (price !== null) {
      referencePrices.set(`${review.ticker}|${review.period}`, price);
    }
  }

  const { observations, pending } = skillObservations(
    input.reviews,
    seriesByTicker,
    input.today,
  );

  return {
    momentumByTicker,
    referencePrices,
    skill: valuationSkill(observations, pending, config),
    unavailable: unavailable.sort(),
  };
}
