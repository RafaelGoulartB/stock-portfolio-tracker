import type { NextResult } from "@portifolio-tracker/shared";
import {
  type YahooCredentials,
  YahooSession,
  yahooSession,
} from "../yahoo-session";
import type { ResultDateAsset, ResultDateProvider } from "./provider";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1_000;
const ABSENT_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 30 * 60 * 1_000;

type ResultCacheEntry = {
  value: NextResult | null;
  expiresAt: number;
};

type YahooEvent = {
  startdatetime?: string | number;
  startDate?: string | number;
  earningsDate?: { raw?: number; fmt?: string }[];
  earningsCallDate?: { raw?: number; fmt?: string }[];
  isEarningsDateEstimate?: boolean;
  period?: string;
  quarter?: string;
};

function unixToDate(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function valueToDate(value: unknown): string | null {
  if (typeof value === "number") return unixToDate(value);
  if (typeof value !== "string") return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)?.[0];
  if (iso) {
    const date = new Date(`${iso}T00:00:00Z`);
    return date.toISOString().slice(0, 10) === iso ? iso : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? unixToDate(numeric) : null;
}

function eventDates(event: YahooEvent): string[] {
  const candidates = [
    valueToDate(event.startdatetime),
    valueToDate(event.startDate),
    ...(event.earningsDate ?? []).map(
      (entry) => valueToDate(entry.raw) ?? valueToDate(entry.fmt),
    ),
    ...(event.earningsCallDate ?? []).map(
      (entry) => valueToDate(entry.raw) ?? valueToDate(entry.fmt),
    ),
  ];

  return [
    ...new Set(candidates.filter((date): date is string => !!date)),
  ].sort();
}

function periodFromEvent(event: YahooEvent): string | null {
  return event.period?.trim() || event.quarter?.trim() || null;
}

export class YahooResultProvider implements ResultDateProvider {
  readonly id = "yahoo" as const;
  private readonly cache = new Map<string, ResultCacheEntry>();
  private readonly pending = new Map<string, Promise<NextResult | null>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly session = new YahooSession(fetchImpl, now),
  ) {}

  async getNextResult(
    asset: ResultDateAsset,
    today: string,
  ): Promise<NextResult | null> {
    const symbol = this.toSymbol(asset);
    if (!symbol) return null;

    const hit = this.cache.get(symbol);
    if (hit && hit.expiresAt > this.now()) {
      if (!hit.value || hit.value.date >= today) return hit.value;
      this.cache.delete(symbol);
    }

    const inFlight = this.pending.get(symbol);
    if (inFlight) return inFlight;

    const result = this.resolveAndCache(symbol, asset, today);
    this.pending.set(symbol, result);

    try {
      return await result;
    } finally {
      this.pending.delete(symbol);
    }
  }

  clearCache() {
    this.session.invalidate();
    this.cache.clear();
    this.pending.clear();
  }

  private toSymbol(asset: ResultDateAsset): string | null {
    const ticker = asset.ticker.trim().toUpperCase();
    if (!ticker) return null;
    if (asset.assetClass === "stock_br") {
      return ticker.endsWith(".SA") ? ticker : `${ticker}.SA`;
    }
    if (asset.assetClass === "stock_us") return ticker.replaceAll(".", "-");
    return null;
  }

  private async resolveAndCache(
    symbol: string,
    asset: ResultDateAsset,
    today: string,
  ): Promise<NextResult | null> {
    try {
      const value = await this.fetchResult(symbol, asset, today);
      this.pruneCache();
      this.cache.set(symbol, {
        value,
        expiresAt: this.now() + (value ? POSITIVE_TTL_MS : ABSENT_TTL_MS),
      });
      return value;
    } catch {
      // Network and parsing failures remain contained but retry sooner than absence.
      this.pruneCache();
      this.cache.set(symbol, {
        value: null,
        expiresAt: this.now() + FAILURE_TTL_MS,
      });
      return null;
    }
  }

  private pruneCache() {
    const now = this.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  private async fetchResult(
    symbol: string,
    asset: ResultDateAsset,
    today: string,
  ): Promise<NextResult | null> {
    let { response, session } = await this.fetchCalendar(symbol);
    if (response.status === 401 || response.status === 403) {
      this.session.invalidate(session);
      ({ response, session } = await this.fetchCalendar(symbol));
    }
    if (!response.ok) {
      throw new Error(`Yahoo result request failed (${response.status})`);
    }

    const body = (await response.json()) as {
      quoteSummary?: {
        result?: { calendarEvents?: { earnings?: YahooEvent } }[] | null;
      };
    };
    const event = body.quoteSummary?.result?.[0]?.calendarEvents?.earnings;
    if (!event) return null;

    const date = eventDates(event).find((candidate) => candidate >= today);
    if (!date) return null;

    const dates = eventDates(event).filter((candidate) => candidate >= today);
    return {
      ticker: asset.ticker,
      date,
      period: periodFromEvent(event),
      source: this.id,
      estimated: event.isEarningsDateEstimate === true || dates.length > 1,
    };
  }

  private async fetchCalendar(
    symbol: string,
  ): Promise<{ response: Response; session: YahooCredentials }> {
    const session = await this.session.get();
    const url = new URL(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
    );
    url.searchParams.set("modules", "calendarEvents");
    url.searchParams.set("crumb", session.crumb);

    const response = await this.fetchImpl(url, {
      headers: { Cookie: session.cookie, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    return { response, session };
  }
}

// Shares its cookie/crumb with the quote provider: one handshake per hour.
const defaultProvider = new YahooResultProvider(
  (input, init) => fetch(input, init),
  Date.now,
  yahooSession,
);

export const yahooResultProvider: ResultDateProvider = defaultProvider;

export function clearYahooResultCache() {
  defaultProvider.clearCache();
}
