import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteUnavailableError } from "./provider";
import { clearQuoteCache, toYahooSymbol, YahooProvider } from "./yahoo";

function chartFixture(
  closes: { timestamp: number; close: number | null }[],
  regularMarketPrice = 47.11,
  regularMarketTime = 1788552350,
) {
  return {
    chart: {
      result: [
        {
          meta: {
            currency: "BRL",
            symbol: "PETR4.SA",
            regularMarketPrice,
            regularMarketTime,
          },
          timestamp: closes.map((entry) => entry.timestamp),
          indicators: {
            quote: [{ close: closes.map((entry) => entry.close) }],
          },
        },
      ],
      error: null,
    },
  };
}

function stubFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }));
}

function unixDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);

  return Math.floor(Date.UTC(year, month - 1, date) / 1_000);
}

describe("toYahooSymbol", () => {
  it("qualifies B3 listings with .SA", () => {
    expect(toYahooSymbol("PETR4", "stock_br", "BRL")).toBe("PETR4.SA");
    expect(toYahooSymbol("HGLG11", "reit", "BRL")).toBe("HGLG11.SA");
    expect(toYahooSymbol("BOVA11", "etf", "BRL")).toBe("BOVA11.SA");
  });

  it("keeps US listings as-is and dashes share classes", () => {
    expect(toYahooSymbol("AAPL", "stock_us", "USD")).toBe("AAPL");
    expect(toYahooSymbol("BRK.B", "stock_us", "USD")).toBe("BRK-B");
  });

  it("maps crypto against USD", () => {
    expect(toYahooSymbol("BTC", "crypto", "USD")).toBe("BTC-USD");
  });

  it("marks assets without a public quote as unavailable", () => {
    expect(toYahooSymbol("CDB-2027", "fixed_income", "BRL")).toBeNull();
    expect(toYahooSymbol("ANYTHING", "other", "USD")).toBeNull();
  });
});

describe("YahooProvider", () => {
  beforeEach(() => {
    clearQuoteCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the spot price from the latest session", async () => {
    const fetchMock = stubFetch(chartFixture([]));
    vi.stubGlobal("fetch", fetchMock);

    const quote = await new YahooProvider().getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
    });

    expect(quote).toMatchObject({
      ticker: "PETR4",
      price: "47.11000000",
      currency: "BRL",
      source: "yahoo",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shares concurrent requests for the same quote", async () => {
    const fetchMock = stubFetch(chartFixture([]));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
    };

    const [first, second] = await Promise.all([
      provider.getQuote(request),
      provider.getQuote(request),
    ]);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("includes the previous close for daily performance", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch(
        chartFixture(
          [
            { timestamp: unixDay("2026-09-03"), close: 45.25 },
            { timestamp: unixDay("2026-09-04"), close: 47.11 },
          ],
          47.11,
          unixDay("2026-09-04"),
        ),
      ),
    );

    const quote = await new YahooProvider().getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
    });

    expect(quote).toMatchObject({
      previousClose: "45.25000000",
      previousCloseAsOf: "2026-09-03",
    });
  });

  it("uses the immediately preceding close for historical quotes", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch(
        chartFixture([
          { timestamp: unixDay("2026-09-02"), close: 39.19 },
          { timestamp: unixDay("2026-09-03"), close: 41.97 },
          { timestamp: unixDay("2026-09-04"), close: 41.92 },
        ]),
      ),
    );

    const quote = await new YahooProvider().getQuote({
      ticker: "ITUB4",
      assetClass: "stock_br",
      currency: "BRL",
      asOf: "2026-09-04",
    });

    expect(quote).toMatchObject({
      price: "41.92000000",
      asOf: "2026-09-04",
      previousClose: "41.97000000",
      previousCloseAsOf: "2026-09-03",
    });
  });

  it("resolves a weekend month-end to the previous close", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch(
        chartFixture([
          { timestamp: unixDay("2026-08-27"), close: 46.9 },
          { timestamp: unixDay("2026-08-28"), close: 47.05 },
        ]),
      ),
    );

    const quote = await new YahooProvider().getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
      asOf: "2026-08-30",
    });

    expect(quote).toMatchObject({ price: "47.05000000", asOf: "2026-08-28" });
  });

  it("reports unknown tickers as unavailable", async () => {
    vi.stubGlobal("fetch", stubFetch({ chart: { result: null, error: {} } }));

    await expect(
      new YahooProvider().getQuote({
        ticker: "NOPE",
        assetClass: "stock_br",
        currency: "BRL",
      }),
    ).rejects.toBeInstanceOf(QuoteUnavailableError);
  });

  it("caches quotes within the TTL", async () => {
    const fetchMock = stubFetch(chartFixture([]));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
    };

    await provider.getQuote(request);
    await provider.getQuote(request);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches an exact historical series within the TTL", async () => {
    const fetchMock = stubFetch(
      chartFixture([
        { timestamp: unixDay("2026-08-28"), close: 45.25 },
        { timestamp: unixDay("2026-09-04"), close: 47.11 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
      start: "2025-08-27",
      end: "2026-09-06",
    };

    const first = await provider.getSeries(request);
    const second = await provider.getSeries(request);

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("replaces a cached historical series when refresh is forced", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            chartFixture([{ timestamp: unixDay("2026-09-04"), close: 47.11 }]),
          ),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            chartFixture([{ timestamp: unixDay("2026-09-04"), close: 48.25 }]),
          ),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
      start: "2025-08-27",
      end: "2026-09-06",
    };

    const original = await provider.getSeries(request);
    const refreshed = await provider.getSeries({
      ...request,
      forceRefresh: true,
    });
    const cachedRefresh = await provider.getSeries(request);

    expect(original[0]?.close).toBe("47.11000000");
    expect(refreshed[0]?.close).toBe("48.25000000");
    expect(cachedRefresh).toEqual(refreshed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
