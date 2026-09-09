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

function quoteFixture(
  entries: Array<{
    symbol: string;
    price: number;
    previous?: number;
    time?: number;
  }>,
) {
  return {
    quoteResponse: {
      result: entries.map((entry) => ({
        symbol: entry.symbol,
        regularMarketPrice: entry.price,
        regularMarketPreviousClose: entry.previous ?? 45.25,
        regularMarketTime: entry.time ?? 1788552350,
        currency: "BRL",
      })),
    },
  };
}

function stubYahoo({
  quote,
  chart,
  ok = true,
  status = 200,
}: {
  quote: unknown;
  chart: unknown;
  ok?: boolean;
  status?: number;
}) {
  return vi.fn(async (url: string | URL) => {
    const href = String(url);
    const body = href.includes("/v7/finance/quote") ? quote : chart;
    return { ok, status, json: async () => body };
  });
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

  it("reads the spot price from a batched quote request", async () => {
    const fetchMock = stubYahoo({
      quote: quoteFixture([{ symbol: "PETR4.SA", price: 47.11 }]),
      chart: chartFixture([]),
    });
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
      previousClose: "45.25000000",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v7/finance/quote");
  });

  it("batches concurrent spot quotes into one upstream request", async () => {
    const fetchMock = stubYahoo({
      quote: quoteFixture([
        { symbol: "PETR4.SA", price: 47.11 },
        { symbol: "AAPL", price: 190.12, previous: 188.5 },
      ]),
      chart: chartFixture([]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();

    const [petr, aapl] = await Promise.all([
      provider.getQuote({
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
      }),
      provider.getQuote({
        ticker: "AAPL",
        assetClass: "stock_us",
        currency: "USD",
      }),
    ]);

    expect(petr.price).toBe("47.11000000");
    expect(aapl.price).toBe("190.12000000");
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("PETR4.SA");
    expect(url).toContain("AAPL");
  });

  it("shares concurrent requests for the same quote", async () => {
    const fetchMock = stubYahoo({
      quote: quoteFixture([{ symbol: "PETR4.SA", price: 47.11 }]),
      chart: chartFixture([]),
    });
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

  it("uses the immediately preceding close for historical quotes", async () => {
    vi.stubGlobal(
      "fetch",
      stubYahoo({
        quote: quoteFixture([]),
        chart: chartFixture([
          { timestamp: unixDay("2026-09-02"), close: 39.19 },
          { timestamp: unixDay("2026-09-03"), close: 41.97 },
          { timestamp: unixDay("2026-09-04"), close: 41.92 },
        ]),
      }),
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
      stubYahoo({
        quote: quoteFixture([]),
        chart: chartFixture([
          { timestamp: unixDay("2026-08-27"), close: 46.9 },
          { timestamp: unixDay("2026-08-28"), close: 47.05 },
        ]),
      }),
    );

    const quote = await new YahooProvider().getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
      asOf: "2026-08-30",
    });

    expect(quote).toMatchObject({ price: "47.05000000", asOf: "2026-08-28" });
  });

  it("reuses one historical series for later as-of quotes and windows", async () => {
    const fetchMock = stubYahoo({
      quote: quoteFixture([]),
      chart: chartFixture([
        { timestamp: unixDay("2026-08-28"), close: 45.25 },
        { timestamp: unixDay("2026-09-04"), close: 47.11 },
      ]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();

    await provider.getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
      asOf: "2026-08-30",
    });
    const series = await provider.getSeries({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
      start: "2026-08-01",
      end: "2026-09-06",
    });
    await provider.getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
      asOf: "2026-09-04",
    });

    expect(series).toEqual([
      { asOf: "2026-08-28", close: "45.25000000" },
      { asOf: "2026-09-04", close: "47.11000000" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports unknown tickers as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      stubYahoo({
        quote: { quoteResponse: { result: [] } },
        chart: { chart: { result: null, error: {} } },
      }),
    );

    await expect(
      new YahooProvider().getQuote({
        ticker: "NOPE",
        assetClass: "stock_br",
        currency: "BRL",
      }),
    ).rejects.toBeInstanceOf(QuoteUnavailableError);
  });

  it("caches quotes within the TTL", async () => {
    const fetchMock = stubYahoo({
      quote: quoteFixture([{ symbol: "PETR4.SA", price: 47.11 }]),
      chart: chartFixture([]),
    });
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

  it("replaces a cached spot quote when refresh is forced", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(quoteFixture([{ symbol: "PETR4.SA", price: 47.11 }])),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(quoteFixture([{ symbol: "PETR4.SA", price: 48.25 }])),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
    };

    const original = await provider.getQuote(request);
    const refreshed = await provider.getQuote({
      ...request,
      forceRefresh: true,
    });
    const cachedRefresh = await provider.getQuote(request);

    expect(original.price).toBe("47.11000000");
    expect(refreshed.price).toBe("48.25000000");
    expect(cachedRefresh).toEqual(refreshed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("remembers a definitive missing quote instead of asking again", async () => {
    const fetchMock = stubYahoo({
      quote: { quoteResponse: { result: [] } },
      chart: { chart: { result: null, error: {} } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "NOPE",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
    };

    await expect(provider.getQuote(request)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    await expect(provider.getQuote(request)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remembers a 404 but retries a rate limit or outage", async () => {
    const notFound = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", notFound);
    const provider = new YahooProvider();
    const missing = {
      ticker: "GONE",
      assetClass: "stock_us" as const,
      currency: "USD" as const,
    };

    await expect(provider.getQuote(missing)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    await expect(provider.getQuote(missing)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    expect(notFound).toHaveBeenCalledTimes(2);

    const rateLimited = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", rateLimited);
    const throttled = {
      ticker: "BUSY",
      assetClass: "stock_us" as const,
      currency: "USD" as const,
    };

    await expect(provider.getQuote(throttled)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    await expect(provider.getQuote(throttled)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    expect(rateLimited.mock.calls.length).toBeGreaterThan(2);
  });

  it("does not remember a network failure", async () => {
    const failing = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    vi.stubGlobal("fetch", failing);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
    };

    await expect(provider.getQuote(request)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    await expect(provider.getQuote(request)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );

    expect(failing.mock.calls.length).toBeGreaterThan(2);
  });

  it("lets a forced refresh bypass a remembered series failure", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ chart: { result: null } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            chartFixture([{ timestamp: unixDay("2026-09-04"), close: 51.4 }]),
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
      start: "2026-08-01",
      end: "2026-09-06",
    };

    await expect(provider.getSeries(request)).rejects.toBeInstanceOf(
      QuoteUnavailableError,
    );
    await expect(
      provider.getSeries({ ...request, forceRefresh: true }),
    ).resolves.toEqual([{ asOf: "2026-09-04", close: "51.40000000" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
