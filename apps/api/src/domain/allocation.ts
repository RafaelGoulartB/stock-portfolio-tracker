import type {
  AllocationHistoryPoint,
  AllocationMarkColor,
  AllocationRow,
  AllocationSummary,
  AssetClass,
  AssetReview,
  Currency,
  ScoreConfig,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import {
  CASH_TICKER,
  DEFAULT_SCORE_CONFIG,
  quarterEndDate,
} from "@portifolio-tracker/shared";
import {
  add,
  div,
  formatDecimal,
  isZero,
  sub,
  toDecimal,
  ZERO,
} from "../lib/decimal";
import { executionPrice } from "./fx-execution";
import { type ConsolidationInput, convertMoney } from "./positions";
import { averageGrade, scoreAsset } from "./score";

/** Analysis metadata stored per ticker, as read from `allocation_assets`. */
export type AllocationAssetMeta = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  targetWeight: string | null;
  valuationRef: string | null;
  /** Native per-unit price stored when no public quote exists. */
  manualPrice: string | null;
  /** Soft row highlight token, null when unmarked. */
  markColor: AllocationMarkColor | null;
  sortOrder: number;
};

export type StoredReview = AssetReview & { ticker: string };

/** A quote resolved for a ticker with no open position (watch-only). */
export type WatchQuote = { price: string; currency: Currency };

const WEIGHT_PLACES = 8;
const MONEY_PLACES = 2;
const ONE = toDecimal("1");
/**
 * Rank of a ticker that has no metadata row yet: it never went through the
 * free-order mode, so it trails the rows the user placed by hand.
 */
const UNRANKED = 1_000_000;

/**
 * Signed discount of the market price to the user's fair value:
 * `(fairValue - marketPrice) / fairValue`. Positive means the stock trades
 * below the valuation; negative means it trades above. Null when either side
 * is missing — the score engine then treats the discount as zero.
 */
export function discountFromFairValue(
  fairValue: string | null,
  marketPrice: string | null,
): string | null {
  if (fairValue === null || marketPrice === null) {
    return null;
  }

  const fair = toDecimal(fairValue);

  if (fair <= ZERO) {
    return null;
  }

  return formatDecimal(
    div(sub(fair, toDecimal(marketPrice)), fair),
    WEIGHT_PLACES,
  );
}

/**
 * Newest quarterly fair value. Period keys (`2026Q1`) sort chronologically as
 * plain strings, so the last review with a value wins.
 */
export function latestFairValue(
  reviews: readonly {
    period: string;
    fairValue: string | null;
    fairValueRef?: string | null;
  }[],
): { fairValue: string; period: string; fairValueRef: string | null } | null {
  let best: {
    fairValue: string;
    period: string;
    fairValueRef: string | null;
  } | null = null;

  for (const review of reviews) {
    if (review.fairValue === null) {
      continue;
    }

    if (best === null || review.period > best.period) {
      best = {
        fairValue: review.fairValue,
        period: review.period,
        fairValueRef: review.fairValueRef ?? null,
      };
    }
  }

  return best;
}

const MAX_HISTORY_POINTS = 360;

/**
 * Carries each quarterly fair value forward from that quarter's last day,
 * onto a daily close series. Points before the first valuation stay null.
 * Long series are thinned so the chart stays light.
 */
export function overlayFairValueOnCloses(
  closes: readonly { asOf: string; close: string }[],
  reviews: readonly { period: string; fairValue: string | null }[],
): AllocationHistoryPoint[] {
  const steps = reviews
    .filter(
      (review): review is { period: string; fairValue: string } =>
        review.fairValue !== null,
    )
    .map((review) => ({
      from: quarterEndDate(review.period),
      fairValue: review.fairValue,
    }))
    .sort((a, b) => a.from.localeCompare(b.from));

  const points: AllocationHistoryPoint[] = closes.map((point) => {
    let fairValue: string | null = null;

    for (const step of steps) {
      if (step.from <= point.asOf) {
        fairValue = step.fairValue;
      }
    }

    return { asOf: point.asOf, close: point.close, fairValue };
  });

  if (points.length <= MAX_HISTORY_POINTS) {
    return points;
  }

  const stride = (points.length - 1) / (MAX_HISTORY_POINTS - 1);
  const sampled: AllocationHistoryPoint[] = [];
  let lastIndex = -1;

  for (let slot = 0; slot < MAX_HISTORY_POINTS; slot += 1) {
    const index = Math.round(slot * stride);

    if (index !== lastIndex) {
      const point = points[index];

      if (point) {
        sampled.push(point);
        lastIndex = index;
      }
    }
  }

  const tail = points[points.length - 1];

  if (tail && sampled[sampled.length - 1]?.asOf !== tail.asOf) {
    sampled.push(tail);
  }

  return sampled;
}

/**
 * Native price in the display currency. A cross-currency price with no rate
 * available stays `null` rather than guessing a conversion.
 */
function convertPrice(
  price: string | null,
  from: Currency,
  displayCurrency: Currency,
  usdBrlRate: string | null,
): string | null {
  if (price === null) {
    return null;
  }

  if (from === displayCurrency) {
    return convertMoney(price, from, displayCurrency, "1");
  }

  return usdBrlRate === null
    ? null
    : convertMoney(price, from, displayCurrency, usdBrlRate);
}

const PRICE_PLACES = 8;

/**
 * Turns a display-currency market value into the native per-unit price the
 * quote fallback stores. Quantity must be positive.
 */
export function manualPriceFromMarketValue(
  marketValue: string,
  quantity: string,
  valueCurrency: Currency,
  assetCurrency: Currency,
  usdBrlRate: string | null,
): string {
  if (isZero(toDecimal(quantity))) {
    throw new Error("A position is required to set a market value");
  }

  if (valueCurrency !== assetCurrency && usdBrlRate == null) {
    throw new Error(
      "An USD/BRL rate is required to set a mixed-currency value",
    );
  }

  const nativeValue = convertMoney(
    marketValue,
    valueCurrency,
    assetCurrency,
    usdBrlRate ?? "1",
  );

  return formatDecimal(
    div(toDecimal(nativeValue), toDecimal(quantity)),
    PRICE_PLACES,
  );
}

/** Date of the last buy per ticker, `YYYY-MM-DD`. Sells never reset it. */
export function lastContributions(
  transactions: readonly ConsolidationInput[],
): Map<string, string> {
  const byTicker = new Map<string, string>();

  for (const entry of transactions) {
    if (entry.side !== "buy") {
      continue;
    }

    const current = byTicker.get(entry.ticker);

    if (!current || entry.tradedAt > current) {
      byTicker.set(entry.ticker, entry.tradedAt);
    }
  }

  return byTicker;
}

export type AllocationInput = {
  /** Valued positions of the live portfolio, in the display currency. */
  positions: readonly ValuedPosition[];
  assets: readonly AllocationAssetMeta[];
  reviews: readonly StoredReview[];
  lastContributionByTicker: ReadonlyMap<string, string>;
  /** Prices for watch-only tickers, which carry no position to value. */
  watchQuotes?: ReadonlyMap<string, WatchQuote>;
  displayCurrency: Currency;
  /** BRL per 1 USD, needed to price an asset in a foreign currency. */
  usdBrlRate?: string | null;
  /** Tickers valued from a stored manual price after the live quote failed. */
  manualValuedTickers?: ReadonlySet<string>;
  /** Reference day for the cooldown rule, `YYYY-MM-DD`. */
  today: string;
  config?: ScoreConfig;
};

/**
 * Joins the three sources behind the allocation screen into one row per
 * ticker: the consolidated position, the analysis metadata (target, manual
 * order) and the quarterly reviews. Every row is scored. Discount comes from
 * the newest review that carries a fair value.
 */
export function buildAllocationRows(input: AllocationInput): AllocationRow[] {
  const config = input.config ?? DEFAULT_SCORE_CONFIG;
  const assetByTicker = new Map(
    input.assets.map((asset) => [asset.ticker, asset]),
  );
  const reviewsByTicker = new Map<string, AssetReview[]>();

  for (const review of input.reviews) {
    const list = reviewsByTicker.get(review.ticker) ?? [];

    list.push({
      period: review.period,
      grade: review.grade,
      notes: review.notes,
      fairValue: review.fairValue,
      fairValueRef: review.fairValueRef,
      watchNext: review.watchNext,
    });
    reviewsByTicker.set(review.ticker, list);
  }

  const openPositions = input.positions.filter(
    (position) => Number(position.quantity) > 0,
  );
  const positionByTicker = new Map(
    openPositions.map((position) => [position.ticker, position]),
  );
  const assignedTarget = input.assets.reduce(
    (total, asset) =>
      asset.ticker === CASH_TICKER || asset.targetWeight === null
        ? total
        : add(total, toDecimal(asset.targetWeight)),
    ZERO,
  );
  const cashTarget = formatDecimal(
    assignedTarget >= ONE ? ZERO : sub(ONE, assignedTarget),
    WEIGHT_PLACES,
  );
  const tickers = new Set([
    ...openPositions.map((position) => position.ticker),
    ...assetByTicker.keys(),
  ]);

  const rows = [...tickers].map((ticker): AllocationRow => {
    const isCash = ticker === CASH_TICKER;
    const position = positionByTicker.get(ticker);
    const asset = assetByTicker.get(ticker);
    const watchQuote = input.watchQuotes?.get(ticker);
    const currency =
      position?.currency ?? asset?.currency ?? input.displayCurrency;
    const marketPrice = isCash
      ? null
      : (position?.marketPrice ?? watchQuote?.price ?? null);
    // Period keys sort chronologically, so plain text order is enough.
    const reviews = (reviewsByTicker.get(ticker) ?? []).sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    const latest = latestFairValue(reviews);
    const fairValue = latest?.fairValue ?? null;
    const discount = discountFromFairValue(fairValue, marketPrice);
    const grades = averageGrade(reviews, config);
    const currentWeight = formatDecimal(
      toDecimal(position?.weight ?? "0"),
      WEIGHT_PLACES,
    );
    const targetWeight = isCash ? cashTarget : (asset?.targetWeight ?? null);
    const lastContributionAt =
      input.lastContributionByTicker.get(ticker) ?? null;
    const marketValue = position?.convertedMarketValue ?? null;
    // Native open result and total, taken from the already-valued position so
    // the client never re-derives money math from formatted strings.
    const unrealizedPnl = position?.unrealizedPnl ?? null;
    const unrealizedPnlPercent = position?.unrealizedPnlPercent ?? null;
    const realizedPnl = position?.realizedPnl ?? formatDecimal(ZERO, 2);
    const totalResult = formatDecimal(
      unrealizedPnl === null
        ? toDecimal(realizedPnl)
        : add(toDecimal(realizedPnl), toDecimal(unrealizedPnl)),
      2,
    );
    const execution = executionPrice(
      marketPrice,
      currency,
      input.displayCurrency,
      input.usdBrlRate ?? null,
    );
    const valueSource =
      marketValue === null
        ? "none"
        : input.manualValuedTickers?.has(ticker)
          ? "manual"
          : "quote";

    return {
      ticker,
      assetClass: position?.assetClass ?? asset?.assetClass ?? "other",
      currency,
      displayCurrency: input.displayCurrency,
      tracked: isCash || asset !== undefined,
      hasPosition: position !== undefined,
      quantity: position?.quantity ?? "0",
      averagePrice: position?.averagePrice ?? "0",
      marketPrice,
      convertedMarketPrice: convertPrice(
        marketPrice,
        currency,
        input.displayCurrency,
        input.usdBrlRate ?? null,
      ),
      executionPrice: execution.price,
      executionFxApplied: execution.fxApplied,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      totalResult,
      currentWeight,
      targetWeight,
      gapWeight:
        targetWeight === null
          ? null
          : formatDecimal(
              sub(toDecimal(targetWeight), toDecimal(currentWeight)),
              WEIGHT_PLACES,
            ),
      fairValue,
      fairValuePeriod: latest?.period ?? null,
      fairValueRef: latest?.fairValueRef ?? null,
      discount,
      valueSource: isCash ? "manual" : valueSource,
      manualPrice: isCash ? null : (asset?.manualPrice ?? null),
      averageGrade: grades.average,
      gradedQuarters: grades.quarters,
      lastContributionAt,
      valuationRef: asset?.valuationRef ?? null,
      markColor: asset?.markColor ?? null,
      sortOrder: isCash ? -1 : (asset?.sortOrder ?? UNRANKED),
      quoteMissing: position?.quoteMissing ?? false,
      score: scoreAsset(
        {
          targetWeight,
          currentWeight,
          discount,
          averageGrade: grades.average,
          lastContributionAt,
          today: input.today,
        },
        config,
      ),
      reviews,
    };
  });

  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.ticker.localeCompare(b.ticker),
  );
}

export function summarizeAllocation(
  rows: readonly AllocationRow[],
  displayCurrency: Currency,
  config: ScoreConfig = DEFAULT_SCORE_CONFIG,
): AllocationSummary {
  let totalMarketValue = ZERO;
  let totalTargetWeight = ZERO;
  let totalCurrentWeight = ZERO;
  let discountSum = ZERO;
  let discountCount = 0;
  let investedAssets = 0;
  let watchOnlyAssets = 0;
  let candidates = 0;
  let blocked = 0;
  let trimCandidates = 0;

  for (const row of rows) {
    if (row.marketValue !== null) {
      totalMarketValue = add(totalMarketValue, toDecimal(row.marketValue));
    }

    if (row.targetWeight !== null) {
      totalTargetWeight = add(totalTargetWeight, toDecimal(row.targetWeight));
    }

    totalCurrentWeight = add(totalCurrentWeight, toDecimal(row.currentWeight));

    if (row.discount !== null) {
      discountSum = add(discountSum, toDecimal(row.discount));
      discountCount += 1;
    }

    if (row.hasPosition) {
      investedAssets += 1;
    } else {
      watchOnlyAssets += 1;
    }

    const score = Number(row.score.value);

    if (score > 0) {
      candidates += 1;
    } else if (score < 0) {
      trimCandidates += 1;
    }

    if (row.score.blocked) {
      blocked += 1;
    }
  }

  return {
    displayCurrency,
    totalMarketValue: formatDecimal(totalMarketValue, MONEY_PLACES),
    totalTargetWeight: formatDecimal(totalTargetWeight, WEIGHT_PLACES),
    totalCurrentWeight: formatDecimal(totalCurrentWeight, WEIGHT_PLACES),
    averageDiscount:
      discountCount === 0
        ? null
        : formatDecimal(
            div(discountSum, toDecimal(String(discountCount))),
            WEIGHT_PLACES,
          ),
    investedAssets,
    watchOnlyAssets,
    candidates,
    blocked,
    trimCandidates,
    scoreVersion: config.version,
  };
}
