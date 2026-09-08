import type { NextResult } from "@portifolio-tracker/shared";
import type { ResultDateAsset, ResultDateProvider } from "./provider";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SESSION_TTL_MS = 60 * 60 * 1_000;
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1_000;
const ABSENT_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 30 * 60 * 1_000;

type YahooSession = {
  cookie: string;
  crumb: string;
  expiresAt: number;
};

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

function normalizeCookie(headers: Headers): string | null {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  const values = getSetCookie?.length
    ? getSetCookie
    : [headers.get("set-cookie")].filter((value): value is string => !!value);
  const cookie = values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");

  return cookie || null;
}

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
  private session: YahooSession | null = null;
  private readonly cache = new Map<string, ResultCacheEntry>();
  private readonly pending = new Map<string, Promise<NextResult | null>>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
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
    this.session = null;
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
    let response = await this.fetchCalendar(symbol);
    if (response.status === 401 || response.status === 403) {
      this.session = null;
      response = await this.fetchCalendar(symbol);
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

  private async fetchCalendar(symbol: string): Promise<Response> {
    const session = await this.getSession();
    const url = new URL(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
    );
    url.searchParams.set("modules", "calendarEvents");
    url.searchParams.set("crumb", session.crumb);

    return this.fetchImpl(url, {
      headers: { Cookie: session.cookie, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  }

  private async getSession(): Promise<YahooSession> {
    if (this.session && this.session.expiresAt > this.now()) {
      return this.session;
    }

    const cookieResponse = await this.fetchImpl("https://fc.yahoo.com/", {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (
      !cookieResponse.ok &&
      ![301, 302, 404].includes(cookieResponse.status)
    ) {
      throw new Error(`Yahoo cookie request failed (${cookieResponse.status})`);
    }

    const cookie = normalizeCookie(cookieResponse.headers);
    if (!cookie) throw new Error("Yahoo did not return a session cookie");

    const crumbResponse = await this.fetchImpl(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: { Cookie: cookie, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!crumbResponse.ok) {
      throw new Error(`Yahoo crumb request failed (${crumbResponse.status})`);
    }

    const crumb = (await crumbResponse.text()).trim();
    if (!crumb) throw new Error("Yahoo did not return a crumb");

    this.session = {
      cookie,
      crumb,
      expiresAt: this.now() + SESSION_TTL_MS,
    };
    return this.session;
  }
}

const defaultProvider = new YahooResultProvider();

export const yahooResultProvider: ResultDateProvider = defaultProvider;

export function clearYahooResultCache() {
  defaultProvider.clearCache();
}
