import {
  type AssetClass,
  CASH_TICKER,
  type Currency,
  DEFAULT_SCORE_CONFIG,
  type QuoteSource,
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
/**
 * Days fetched before the oldest fair value, so a reference day that fell on
 * a weekend or holiday (every 31 December on B3) still finds a prior close.
 */
const REFERENCE_LEAD_DAYS = 10;

function daysBefore(day: string, days: number): string {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, date - days))
    .toISOString()
    .slice(0, 10);
}

export type MarketSignalAsset = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  targetWeight: string | null;
};

export type MarketSignals = {
  /** 12-1 month log return per ticker, only where a year of prices exists. */
  momentumByTicker: Map<string, string>;
  /** Close on the day each `ticker|period` fair value was known. */
  referencePrices: Map<string, string>;
  skill: ValuationSkill;
  /** Tickers whose price history could not be loaded. */
  unavailable: string[];
  /**
   * False with manual quotes: a manual price has no real history, so trend,
   * review nudges and the track record are off rather than computed from a
   * flat line.
   */
  available: boolean;
};

/**
 * Loads the price history behind the score's market signals: momentum for
 * targeted assets, and the closes on the day each fair value was known and
 * 12 months later (the valuation track record). History is never stored;
 * the quote provider's series cache keeps repeat loads cheap. A user's
 * "refresh quotes" deliberately does not force these: 12-1 momentum skips
 * the latest month and reference closes are in the past, so refetching
 * every multi-year series would spend provider quota without changing them. A ticker whose
 * history fails has no signal, which the score treats as neutral, and is
 * reported in `unavailable` (and as `missing` in the skill) so the screen
 * can say so.
 */
export async function loadMarketSignals(input: {
  assets: readonly MarketSignalAsset[];
  reviews: readonly FairValueReview[];
  today: string;
  quoteSource: QuoteSource;
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
    (earliest, review) =>
      earliest === null || review.asOf < earliest ? review.asOf : earliest,
    null,
  );
  const momentumStart = monthsAgo(input.today, MOMENTUM_LOOKBACK_MONTHS);
  const start =
    earliestReview !== null &&
    daysBefore(earliestReview, REFERENCE_LEAD_DAYS) < momentumStart
      ? daysBefore(earliestReview, REFERENCE_LEAD_DAYS)
      : momentumStart;
  const limit = createConcurrencyLimiter(SERIES_CONCURRENCY);
  const seriesByTicker = new Map<string, ClosePoint[]>();
  const unavailable: string[] = [];

  if (input.quoteSource === "manual") {
    const { pending, missing } = skillObservations(
      input.reviews,
      new Map(),
      input.today,
    );

    return {
      momentumByTicker: new Map(),
      referencePrices: new Map(),
      skill: valuationSkill([], { pending, missing }, config),
      unavailable: [],
      available: false,
    };
  }

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
    const price = referencePrice(points, review.asOf);
    if (price !== null) {
      referencePrices.set(`${review.ticker}|${review.period}`, price);
    }
  }

  const { observations, pending, missing } = skillObservations(
    input.reviews,
    seriesByTicker,
    input.today,
  );

  return {
    momentumByTicker,
    referencePrices,
    skill: valuationSkill(observations, { pending, missing }, config),
    unavailable: unavailable.sort(),
    available: true,
  };
}
