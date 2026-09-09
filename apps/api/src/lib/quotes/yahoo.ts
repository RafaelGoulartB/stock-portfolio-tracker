import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { coalesce, createConcurrencyLimiter, pruneExpired } from "../async";
import { formatDecimal, toDecimal } from "../decimal";
import { spotStaleWhileRevalidateMs, spotTtlMs } from "../market-hours";
import {
  type MarketQuote,
  type QuoteProvider,
  type QuoteRequest,
  type QuoteSeriesPoint,
  type QuoteSeriesRequest,
  QuoteUnavailableError,
} from "./provider";

type CacheEntry = {
  quote: MarketQuote;
  expiresAt: number;
  staleUntil: number;
};

export type YahooDividendPoint = { exDate: string; amount: string };

type SeriesCacheEntry = {
  points: QuoteSeriesPoint[];
  dividends: YahooDividendPoint[];
  start: string;
  end: string;
  expiresAt: number;
  staleUntil: number;
};

type FailureEntry = { ticker: string; message: string; expiresAt: number };

type ChartResult = {
  meta?: {
    regularMarketPrice?: number;
    regularMarketTime?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
  events?: {
    dividends?: Record<string, { amount?: number; date?: number }>;
  };
};

type YahooQuoteResult = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  regularMarketPreviousClose?: number;
};

type PendingSpot = {
  request: QuoteRequest;
  symbol: string;
  resolve: (quote: MarketQuote) => void;
  reject: (error: unknown) => void;
};

const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const SERIES_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 10 * 60 * 1_000;
const CANONICAL_LOOKBACK_MONTHS = 36;
const SERIES_LEAD_DAYS = 12;
const QUOTE_BATCH_SIZE = 40;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const cache = new Map<string, CacheEntry>();
const seriesCache = new Map<string, SeriesCacheEntry>();
const failureCache = new Map<string, FailureEntry>();
const pendingQuotes = new Map<string, Promise<MarketQuote>>();
const pendingSeries = new Map<string, Promise<SeriesCacheEntry>>();
const limitUpstream = createConcurrencyLimiter(8);

let queuedSpots: PendingSpot[] = [];
let flushScheduled = false;
const refreshingSpots = new Set<string>();
const refreshingSeries = new Set<string>();

function pruneStale<T extends { staleUntil: number }>(entries: Map<string, T>) {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.staleUntil <= now) {
      entries.delete(key);
    }
  }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  return shifted.toISOString().slice(0, 10);
}

function shiftMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, date));
  return shifted.toISOString().slice(0, 10);
}

function dayToUnix(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 1_000);
}

function unixToDay(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
}

function toPriceString(raw: number, ticker: string): string {
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new QuoteUnavailableError(ticker);
  }
  return formatDecimal(toDecimal(raw.toFixed(8)), 8);
}

function covers(entry: SeriesCacheEntry, start: string, end: string): boolean {
  return entry.start <= start && entry.end >= end;
}

function closeOnOrBefore(
  points: readonly QuoteSeriesPoint[],
  asOf: string,
): QuoteSeriesPoint | undefined {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && point.asOf <= asOf) {
      return point;
    }
  }
  return undefined;
}

function previousPoint(
  points: readonly QuoteSeriesPoint[],
  asOf: string,
): QuoteSeriesPoint | undefined {
  const current = closeOnOrBefore(points, asOf);
  if (!current) {
    return undefined;
  }
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && point.asOf < current.asOf) {
      return point;
    }
  }
  return undefined;
}

function widenRange(
  start: string,
  end: string,
): { start: string; end: string } {
  const today = todayUtc();
  const canonicalStart = shiftDays(
    shiftMonths(today, -CANONICAL_LOOKBACK_MONTHS),
    -SERIES_LEAD_DAYS,
  );
  return {
    start: start < canonicalStart ? start : canonicalStart,
    end: end > today ? end : today,
  };
}

function retryDelayMs(attempt: number): number {
  return process.env.VITEST ? 0 : 250 * 2 ** attempt;
}

async function fetchYahoo(url: string, ticker: string): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await limitUpstream(() =>
        fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(10_000),
        }),
      );

      if (response.status === 429 || response.status >= 500) {
        lastError = new QuoteUnavailableError(
          ticker,
          `Quote request failed (${response.status})`,
          { transient: true },
        );
        if (attempt < 2) {
          await new Promise((resolve) => {
            setTimeout(resolve, retryDelayMs(attempt));
          });
          continue;
        }
        throw lastError;
      }

      return response;
    } catch (error) {
      if (error instanceof QuoteUnavailableError) {
        lastError = error;
        if (!error.transient || attempt === 2) {
          throw error;
        }
      } else {
        lastError = new QuoteUnavailableError(
          ticker,
          error instanceof Error ? error.message : "Quote provider failed",
          { transient: true },
        );
        if (attempt === 2) {
          throw lastError;
        }
      }
      await new Promise((resolve) => {
        setTimeout(resolve, retryDelayMs(attempt));
      });
    }
  }

  throw lastError instanceof QuoteUnavailableError
    ? lastError
    : new QuoteUnavailableError(ticker, "Quote provider failed", {
        transient: true,
      });
}

function cachedFailure(key: string): QuoteUnavailableError | null {
  const hit = failureCache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expiresAt <= Date.now()) {
    failureCache.delete(key);
    return null;
  }
  return new QuoteUnavailableError(hit.ticker, hit.message);
}

function rememberFailure(key: string, ticker: string, error: unknown): void {
  if (!(error instanceof QuoteUnavailableError) || error.transient) {
    return;
  }
  pruneExpired(failureCache);
  failureCache.set(key, {
    ticker,
    message: error.message,
    expiresAt: Date.now() + FAILURE_TTL_MS,
  });
}

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

function parseChart(result: ChartResult, ticker: string) {
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: QuoteSeriesPoint[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const close = closes[index];
    if (timestamp == null || close == null || close <= 0) {
      continue;
    }
    points.push({
      asOf: unixToDay(timestamp),
      close: toPriceString(close, ticker),
    });
  }

  const dividends = Object.values(result.events?.dividends ?? {}).flatMap(
    (item): YahooDividendPoint[] => {
      if (
        item.date == null ||
        item.amount == null ||
        !Number.isFinite(item.amount) ||
        item.amount <= 0
      ) {
        return [];
      }
      return [
        {
          exDate: unixToDay(item.date),
          amount: formatDecimal(toDecimal(item.amount.toFixed(8)), 8),
        },
      ];
    },
  );

  return {
    points,
    dividends,
    spotPrice: result.meta?.regularMarketPrice,
  };
}

async function fetchChart(
  symbol: string,
  ticker: string,
  start: string,
  end: string,
): Promise<ChartResult> {
  const response = await fetchYahoo(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${dayToUnix(start)}&period2=${dayToUnix(end) + 86400}&events=div%2Csplits`,
    ticker,
  );

  if (!response.ok) {
    const unknownSymbol = response.status === 404 || response.status === 400;
    throw new QuoteUnavailableError(
      ticker,
      `Quote request failed (${response.status})`,
      { transient: !unknownSymbol },
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

async function fetchQuoteBatch(
  symbols: string[],
  ticker: string,
): Promise<Map<string, YahooQuoteResult>> {
  const quoted = new Map<string, YahooQuoteResult>();

  for (let offset = 0; offset < symbols.length; offset += QUOTE_BATCH_SIZE) {
    const chunk = symbols.slice(offset, offset + QUOTE_BATCH_SIZE);
    const response = await fetchYahoo(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(","))}`,
      ticker,
    );
    if (!response.ok) {
      throw new QuoteUnavailableError(
        ticker,
        `Quote request failed (${response.status})`,
        { transient: response.status !== 404 && response.status !== 400 },
      );
    }
    const body = (await response.json()) as {
      quoteResponse?: { result?: YahooQuoteResult[] | null };
    };
    for (const item of body.quoteResponse?.result ?? []) {
      if (item.symbol) {
        quoted.set(item.symbol, item);
      }
    }
  }

  return quoted;
}

function quoteFromBatch(
  request: QuoteRequest,
  raw: YahooQuoteResult,
): MarketQuote | null {
  if (raw.regularMarketPrice == null) {
    return null;
  }
  try {
    return {
      ticker: request.ticker,
      price: toPriceString(raw.regularMarketPrice, request.ticker),
      currency: request.currency,
      asOf: raw.regularMarketTime
        ? unixToDay(raw.regularMarketTime)
        : todayUtc(),
      previousClose:
        raw.regularMarketPreviousClose != null &&
        raw.regularMarketPreviousClose > 0
          ? toPriceString(raw.regularMarketPreviousClose, request.ticker)
          : undefined,
      source: "yahoo",
    };
  } catch {
    return null;
  }
}

function quoteFromSeries(
  request: QuoteRequest,
  entry: SeriesCacheEntry,
  asOf: string,
  spotPrice?: number,
): MarketQuote {
  const current = closeOnOrBefore(entry.points, asOf);
  if (!current && spotPrice == null) {
    throw new QuoteUnavailableError(request.ticker);
  }
  const price =
    spotPrice != null
      ? toPriceString(spotPrice, request.ticker)
      : current?.close;
  if (!price) {
    throw new QuoteUnavailableError(request.ticker);
  }
  const quoteAsOf = current?.asOf ?? asOf;
  const previous = previousPoint(entry.points, quoteAsOf);
  return {
    ticker: request.ticker,
    price,
    currency: request.currency,
    asOf: quoteAsOf,
    previousClose: previous?.close,
    previousCloseAsOf: previous?.asOf,
    source: "yahoo",
  };
}

async function loadSeriesEntry(
  symbol: string,
  ticker: string,
  start: string,
  end: string,
  forceRefresh = false,
): Promise<SeriesCacheEntry> {
  const now = Date.now();
  const hit = forceRefresh ? undefined : seriesCache.get(symbol);

  if (hit && covers(hit, start, end) && hit.expiresAt > now) {
    return hit;
  }
  if (hit && covers(hit, start, end) && hit.staleUntil > now) {
    if (!refreshingSeries.has(symbol)) {
      refreshingSeries.add(symbol);
      void loadSeriesEntry(symbol, ticker, start, end, true)
        .catch(() => undefined)
        .finally(() => {
          refreshingSeries.delete(symbol);
        });
    }
    return hit;
  }
  if (!forceRefresh) {
    const remembered = cachedFailure(`series|${symbol}`);
    if (remembered) {
      throw remembered;
    }
  }

  return coalesce(pendingSeries, symbol, async () => {
    const range = widenRange(
      hit && !forceRefresh ? (hit.start < start ? hit.start : start) : start,
      hit && !forceRefresh ? (hit.end > end ? hit.end : end) : end,
    );
    try {
      const chart = await fetchChart(symbol, ticker, range.start, range.end);
      const parsed = parseChart(chart, ticker);
      if (parsed.points.length === 0) {
        throw new QuoteUnavailableError(ticker);
      }
      pruneStale(seriesCache);
      const entry: SeriesCacheEntry = {
        points: parsed.points,
        dividends: parsed.dividends,
        start: range.start,
        end: range.end,
        expiresAt: Date.now() + SERIES_TTL_MS,
        staleUntil: Date.now() + SERIES_TTL_MS * 2,
      };
      seriesCache.set(symbol, entry);
      return entry;
    } catch (error) {
      rememberFailure(`series|${symbol}`, ticker, error);
      throw error;
    }
  });
}

export async function loadYahooChart(
  symbol: string,
  ticker: string,
  start: string,
  end: string,
  forceRefresh = false,
): Promise<{ points: QuoteSeriesPoint[]; dividends: YahooDividendPoint[] }> {
  const entry = await loadSeriesEntry(symbol, ticker, start, end, forceRefresh);
  return {
    points: entry.points.filter(
      (point) => point.asOf >= start && point.asOf <= end,
    ),
    dividends: entry.dividends.filter(
      (event) => event.exDate >= start && event.exDate <= end,
    ),
  };
}

function cacheSpot(request: QuoteRequest, symbol: string, quote: MarketQuote) {
  const ttl = spotTtlMs(request.assetClass, request.currency);
  pruneStale(cache);
  cache.set(symbol, {
    quote,
    expiresAt: Date.now() + ttl,
    staleUntil:
      Date.now() +
      ttl +
      spotStaleWhileRevalidateMs(request.assetClass, request.currency),
  });
  failureCache.delete(symbol);
}

async function resolveSpotFromChart(item: PendingSpot): Promise<MarketQuote> {
  const asOf = todayUtc();
  const entry = await loadSeriesEntry(
    item.symbol,
    item.request.ticker,
    shiftDays(asOf, -14),
    asOf,
    item.request.forceRefresh,
  );
  return quoteFromSeries(item.request, entry, asOf);
}

async function flushQuoteBatch(): Promise<void> {
  const batch = queuedSpots;
  queuedSpots = [];
  flushScheduled = false;
  if (batch.length === 0) {
    return;
  }

  const symbols = [...new Set(batch.map((item) => item.symbol))];
  let quoted = new Map<string, YahooQuoteResult>();
  try {
    quoted = await fetchQuoteBatch(symbols, batch[0]?.request.ticker ?? "");
  } catch {
    quoted = new Map();
  }

  const leftover: PendingSpot[] = [];
  for (const item of batch) {
    const raw = quoted.get(item.symbol);
    const quote = raw ? quoteFromBatch(item.request, raw) : null;
    if (quote) {
      cacheSpot(item.request, item.symbol, quote);
      item.resolve(quote);
    } else {
      leftover.push(item);
    }
  }

  await Promise.all(
    leftover.map(async (item) => {
      try {
        const quote = await resolveSpotFromChart(item);
        cacheSpot(item.request, item.symbol, quote);
        item.resolve(quote);
      } catch (error) {
        rememberFailure(item.symbol, item.request.ticker, error);
        item.reject(error);
      }
    }),
  );
}

function enqueueSpot(item: PendingSpot) {
  queuedSpots.push(item);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      void flushQuoteBatch();
    });
  }
}

function cachedSpot(symbol: string): CacheEntry | undefined {
  const hit = cache.get(symbol);
  if (!hit) {
    return undefined;
  }
  if (hit.staleUntil <= Date.now()) {
    cache.delete(symbol);
    return undefined;
  }
  return hit;
}

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
    if (request.asOf) {
      return this.historicalQuote(symbol, request, request.asOf);
    }

    const now = Date.now();
    const hit = request.forceRefresh ? undefined : cachedSpot(symbol);
    if (hit && hit.expiresAt > now) {
      return hit.quote;
    }
    if (hit && hit.staleUntil > now) {
      if (!refreshingSpots.has(symbol)) {
        refreshingSpots.add(symbol);
        void this.refreshSpot(symbol, request).finally(() => {
          refreshingSpots.delete(symbol);
        });
      }
      return hit.quote;
    }

    const remembered = request.forceRefresh ? null : cachedFailure(symbol);
    if (remembered) {
      throw remembered;
    }

    return coalesce(
      pendingQuotes,
      symbol,
      () =>
        new Promise<MarketQuote>((resolve, reject) => {
          enqueueSpot({ request, symbol, resolve, reject });
        }),
    );
  }

  async getSeries(request: QuoteSeriesRequest): Promise<QuoteSeriesPoint[]> {
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
    const { points } = await loadYahooChart(
      symbol,
      request.ticker,
      request.start,
      request.end,
      request.forceRefresh,
    );
    if (points.length === 0) {
      throw new QuoteUnavailableError(request.ticker);
    }
    return points;
  }

  private async historicalQuote(
    symbol: string,
    request: QuoteRequest,
    asOf: string,
  ): Promise<MarketQuote> {
    const remembered = request.forceRefresh ? null : cachedFailure(symbol);
    if (remembered) {
      throw remembered;
    }
    const key = `${symbol}|${asOf}`;
    const hit = request.forceRefresh ? undefined : cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.quote;
    }

    return coalesce(pendingQuotes, key, async () => {
      const entry = await loadSeriesEntry(
        symbol,
        request.ticker,
        asOf,
        asOf,
        request.forceRefresh,
      );
      const quote = quoteFromSeries(request, entry, asOf);
      pruneStale(cache);
      cache.set(key, {
        quote,
        expiresAt: Date.now() + HISTORY_TTL_MS,
        staleUntil: Date.now() + HISTORY_TTL_MS,
      });
      return quote;
    });
  }

  private async refreshSpot(symbol: string, request: QuoteRequest) {
    try {
      await new Promise<MarketQuote>((resolve, reject) => {
        enqueueSpot({ request, symbol, resolve, reject });
      });
    } catch {
      // Keep serving the stale quote; the next caller retries.
    }
  }
}

export function clearQuoteCache(): void {
  cache.clear();
  seriesCache.clear();
  failureCache.clear();
  pendingQuotes.clear();
  pendingSeries.clear();
  queuedSpots = [];
  flushScheduled = false;
  refreshingSpots.clear();
  refreshingSeries.clear();
}
