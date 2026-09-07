import { describe, expect, it } from "vitest";
import {
  getQuoteWithManualFallback,
  getSeriesWithManualFallback,
  QuoteUnavailableError,
} from ".";
import type {
  QuoteProvider,
  QuoteRequest,
  QuoteSeriesRequest,
} from "./provider";

const unavailableProvider: QuoteProvider = {
  id: "yahoo",
  label: "Unavailable",
  async getQuote(request: QuoteRequest) {
    throw new QuoteUnavailableError(request.ticker);
  },
  async getSeries(request: QuoteSeriesRequest) {
    throw new QuoteUnavailableError(request.ticker);
  },
};

const request = {
  ticker: "CDB LIQUIDEZ",
  assetClass: "fixed_income",
  currency: "BRL",
  manualPrice: "12500.50",
} as const;

describe("manual quote fallback", () => {
  it("values an unsupported fixed-income position from its stored price", async () => {
    const result = await getQuoteWithManualFallback(
      unavailableProvider,
      request,
    );

    expect(result.manual).toBe(true);
    expect(result.quote).toMatchObject({
      ticker: request.ticker,
      price: request.manualPrice,
      currency: "BRL",
      source: "manual",
    });
  });

  it("carries the stored price into performance snapshots", async () => {
    const result = await getSeriesWithManualFallback(unavailableProvider, {
      ...request,
      start: "2026-01-01",
      end: "2026-09-07",
    });

    expect(result).toEqual({
      manual: true,
      points: [{ asOf: "2026-01-01", close: request.manualPrice }],
    });
  });
});
