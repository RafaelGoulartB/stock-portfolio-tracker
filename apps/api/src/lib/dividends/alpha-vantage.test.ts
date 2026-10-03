import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlphaVantageQuota } from "../alpha-vantage-quota";
import {
  AlphaVantageDividendProvider,
  clearAlphaVantageDividendCache,
} from "./alpha-vantage";
import { DividendUnavailableError } from "./provider";

function request(ticker: string) {
  return {
    ticker,
    assetClass: "stock_us" as const,
    currency: "USD" as const,
    start: "2025-01-01",
    end: "2026-12-31",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AlphaVantageDividendProvider", () => {
  beforeEach(() => {
    resetAlphaVantageQuota();
    clearAlphaVantageDividendCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops calling for every ticker once the daily quota is refused", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        Information:
          "Our standard API rate limit is 25 requests per day. Please subscribe.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlphaVantageDividendProvider("key");

    await expect(provider.getDividends(request("AAPL"))).rejects.toBeInstanceOf(
      DividendUnavailableError,
    );
    await expect(provider.getDividends(request("MSFT"))).rejects.toThrow(
      "25 requests per day",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("remembers a failed ticker instead of retrying on every page load", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlphaVantageDividendProvider("key");

    await expect(provider.getDividends(request("AAPL"))).rejects.toBeInstanceOf(
      DividendUnavailableError,
    );
    await expect(provider.getDividends(request("AAPL"))).rejects.toBeInstanceOf(
      DividendUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches parsed events for later ranges", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ ex_dividend_date: "2026-02-09", amount: "0.26" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AlphaVantageDividendProvider("key");

    const first = await provider.getDividends(request("AAPL"));
    const second = await provider.getDividends(request("AAPL"));

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
