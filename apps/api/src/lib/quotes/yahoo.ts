import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { formatDecimal, toDecimal } from "../decimal";
import {
  type MarketQuote,
  type QuoteProvider,
  type QuoteRequest,
  QuoteUnavailableError,
} from "./provider";

type CacheEntry = { quote: MarketQuote; expiresAt: number };

const SPOT_TTL_MS = 15 * 60 * 1_000;
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const cache = new Map<string, CacheEntry>();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayToUnix(day: string): number {
  const [year, month, date] = day.split("-").map(Number);

  return Math.floor(Date.UTC(year, month - 1, date) / 1_000);
}

function unixToDay(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
}

/** Decimal strings must never be built from floats without rounding first. */
function toPriceString(raw: number, ticker: string): string {
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new QuoteUnavailableError(ticker);
  }

  return formatDecimal(toDecimal(raw.toFixed(8)), 8);
}

/**
 * Maps a portfolio ticker to its Yahoo symbol. B3 listings trade with a
 * `.SA` suffix, US listings as-is, and crypto against USD (`BTC` ->
 * `BTC-USD`). Fixed income and opaque `other` assets have no public quote
 * and resolve as unavailable.
 */
export function toYahooSymbol(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
): string | null {
  const normalized = ticker
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9.-]/g, "");

  if (!normalized) {
    return null;
  }

  if (assetClass === "fixed_income" || assetClass === "other") {
    return null;
  }

  if (assetClass === "crypto") {
    const base =
      normalized.endsWith("USD") && normalized.length > 3
        ? normalized.slice(0, -3).replaceAll(/[^A-Z0-9]/g, "")
        : normalized.replaceAll(/[^A-Z0-9]/g, "");

    return base ? `${base}-USD` : null;
  }

  if (currency === "BRL") {
    return normalized.includes(".") ? normalized : `${normalized}.SA`;
  }

  return normalized.replaceAll(".", "-");
}

type ChartResult = {
  meta?: {
    currency?: string;
    regularMarketPrice?: number;
    regularMarketTime?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
};

async function fetchChart(
  symbol: string,
  ticker: string,
  period1: number,
  period2: number,
): Promise<ChartResult> {
  let response: Response;

  try {
    response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`,
      {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    throw new QuoteUnavailableError(
      ticker,
      error instanceof Error ? error.message : "Quote provider failed",
    );
  }

  if (!response.ok) {
    throw new QuoteUnavailableError(
      ticker,
      `Quote request failed (${response.status})`,
    );
  }

  const body = (await response.json()) as {
    chart?: { result?: ChartResult[] | null };
  };
  const result = body.chart?.result?.[0];

  if (!result) {
    throw new QuoteUnavailableError(ticker);
  }

  return result;
}

/**
 * Free delayed market quotes, no API key. Spot prices come from the latest
 * regular session; historical closes take the last daily close on or before
 * the requested day so month-ends on weekends resolve to the previous
 * trading session.
 */
export class YahooProvider implements QuoteProvider {
  readonly id = "yahoo" as const;
  readonly label = "Yahoo Finance (free, delayed)";

  async getQuote(request: QuoteRequest): Promise<MarketQuote> {
    const symbol = toYahooSymbol(
      request.ticker,
      request.assetClass,
      request.currency,
    );

    if (!symbol) {
      throw new QuoteUnavailableError(
        request.ticker,
        `No public quote for ${request.ticker}`,
      );
    }

    const key = `${this.id}|${symbol}|${request.asOf ?? "spot"}`;
    const hit = cache.get(key);

    if (hit && hit.expiresAt > Date.now()) {
      return hit.quote;
    }

    const quote =
      request.asOf == null
        ? await this.spotQuote(symbol, request)
        : await this.historicalQuote(symbol, request, request.asOf);

    cache.set(key, {
      quote,
      expiresAt:
        Date.now() + (request.asOf == null ? SPOT_TTL_MS : HISTORY_TTL_MS),
    });

    return quote;
  }

  private async spotQuote(
    symbol: string,
    request: QuoteRequest,
  ): Promise<MarketQuote> {
    const now = Math.floor(Date.now() / 1_000);
    const result = await fetchChart(
      symbol,
      request.ticker,
      now - 14 * 86400,
      now + 86400,
    );
    const price = result.meta?.regularMarketPrice;

    if (price == null) {
      throw new QuoteUnavailableError(request.ticker);
    }

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    let latestSeriesDay: string | undefined;

    for (let index = timestamps.length - 1; index >= 0; index -= 1) {
      const timestamp = timestamps[index];
      const close = closes[index];

      if (timestamp != null && close != null) {
        latestSeriesDay = unixToDay(timestamp);
        break;
      }
    }

    const quoteAsOf =
      latestSeriesDay ??
      (result.meta?.regularMarketTime
        ? unixToDay(result.meta.regularMarketTime)
        : todayUtc());
    let previousCloseAsOf: string | undefined;
    let previousClose: string | undefined;

    for (let index = timestamps.length - 1; index >= 0; index -= 1) {
      const timestamp = timestamps[index];
      const close = closes[index];

      if (timestamp == null || close == null) {
        continue;
      }

      const day = unixToDay(timestamp);
      if (day < quoteAsOf) {
        previousCloseAsOf = day;
        previousClose = toPriceString(close, request.ticker);
        break;
      }
    }

    return {
      ticker: request.ticker,
      price: toPriceString(price, request.ticker),
      currency: request.currency,
      asOf: quoteAsOf,
      previousClose,
      previousCloseAsOf,
      source: this.id,
    };
  }

  private async historicalQuote(
    symbol: string,
    request: QuoteRequest,
    asOf: string,
  ): Promise<MarketQuote> {
    // The daily series is ascending; the last close at or before the end of
    // the snapshot day is the snapshot close.
    const endOfDay = dayToUnix(asOf) + 86400;
    const result = await fetchChart(
      symbol,
      request.ticker,
      endOfDay - 12 * 86400,
      endOfDay,
    );

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];

    for (let index = timestamps.length - 1; index >= 0; index -= 1) {
      const timestamp = timestamps[index];
      const close = closes[index];

      if (timestamp == null || timestamp >= endOfDay || close == null) {
        continue;
      }

      let previousClose: string | undefined;
      let previousCloseAsOf: string | undefined;

      for (
        let previousIndex = index - 1;
        previousIndex >= 0;
        previousIndex -= 1
      ) {
        const previousTimestamp = timestamps[previousIndex];
        const previousValue = closes[previousIndex];

        if (previousTimestamp != null && previousValue != null) {
          previousClose = toPriceString(previousValue, request.ticker);
          previousCloseAsOf = unixToDay(previousTimestamp);
          break;
        }
      }

      return {
        ticker: request.ticker,
        price: toPriceString(close, request.ticker),
        currency: request.currency,
        asOf: unixToDay(timestamp),
        previousClose,
        previousCloseAsOf,
        source: this.id,
      };
    }

    throw new QuoteUnavailableError(request.ticker);
  }
}

/** Clears cached quotes. Exported for tests. */
export function clearQuoteCache(): void {
  cache.clear();
}
