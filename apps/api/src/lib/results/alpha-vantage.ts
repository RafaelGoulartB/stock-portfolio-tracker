import type { NextResult } from "@portifolio-tracker/shared";
import { parse } from "csv-parse/sync";
import type { ResultDateAsset, ResultDateProvider } from "./provider";

const BASE_URL = "https://www.alphavantage.co/query";
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type CalendarCache = {
  events: Map<string, string[]>;
  expiresAt: number;
};

type CalendarRow = Record<string, string | undefined>;

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
}

function readColumn(row: CalendarRow, names: string[]): string | undefined {
  for (const [key, value] of Object.entries(row)) {
    if (names.includes(normalizeHeader(key))) {
      return value?.trim();
    }
  }

  return undefined;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value ? value : null;
}

/** Parses all known earnings dates so a past row cannot hide a future one. */
export function parseAlphaVantageCalendar(csv: string): Map<string, string[]> {
  const rows = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CalendarRow[];
  const byTicker = new Map<string, Set<string>>();

  for (const row of rows) {
    const ticker = readColumn(row, ["symbol", "ticker"])?.toUpperCase();
    const date = normalizeDate(
      readColumn(row, ["reportdate", "reportingdate", "date"]),
    );

    if (!ticker || !date) continue;
    const dates = byTicker.get(ticker) ?? new Set<string>();
    dates.add(date);
    byTicker.set(ticker, dates);
  }

  return new Map(
    [...byTicker].map(([ticker, dates]) => [ticker, [...dates].sort()]),
  );
}

export class AlphaVantageResultProvider implements ResultDateProvider {
  readonly id = "alpha_vantage" as const;
  private cache: CalendarCache | null = null;
  private pending: Promise<Map<string, string[]>> | null = null;

  constructor(
    private readonly apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getNextResult(
    asset: ResultDateAsset,
    today: string,
  ): Promise<NextResult | null> {
    if (asset.assetClass !== "stock_us" || !this.apiKey) return null;

    const events = await this.loadCalendar();
    const date = events
      .get(asset.ticker.trim().toUpperCase())
      ?.find((candidate) => candidate >= today);
    if (!date) return null;

    return {
      ticker: asset.ticker,
      date,
      period: null,
      source: this.id,
      estimated: false,
    };
  }

  clearCache() {
    this.cache = null;
    this.pending = null;
  }

  private async loadCalendar(): Promise<Map<string, string[]>> {
    if (this.cache && this.cache.expiresAt > this.now()) {
      return this.cache.events;
    }
    if (this.pending) return this.pending;

    this.pending = this.fetchCalendar();

    try {
      const events = await this.pending;
      this.cache = { events, expiresAt: this.now() + CACHE_TTL_MS };
      return events;
    } finally {
      this.pending = null;
    }
  }

  private async fetchCalendar(): Promise<Map<string, string[]>> {
    const url = new URL(BASE_URL);
    url.searchParams.set("function", "EARNINGS_CALENDAR");
    url.searchParams.set("horizon", "12month");
    url.searchParams.set("apikey", this.apiKey ?? "");

    const response = await this.fetchImpl(url, {
      headers: { Accept: "text/csv" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Alpha Vantage request failed (${response.status})`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("Alpha Vantage response is too large");
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error("Alpha Vantage response is too large");
    }
    if (contentType?.includes("json") || /^\s*[{[]/.test(text)) {
      throw new Error("Alpha Vantage did not return an earnings calendar");
    }

    return parseAlphaVantageCalendar(text);
  }
}

const defaultProvider = new AlphaVantageResultProvider();

export const alphaVantageResultProvider: ResultDateProvider = defaultProvider;

export function clearAlphaVantageResultCache() {
  defaultProvider.clearCache();
}
