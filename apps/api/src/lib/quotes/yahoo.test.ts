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
  status = 200,
  quoteStatus,
}: {
  quote: unknown;
  chart: unknown;
  status?: number;
  quoteStatus?: number;
}) {
  return vi.fn(async (url: string | URL) => {
    const href = String(url);
    if (href.startsWith("https://fc.yahoo.com")) {
      return new Response("", {
        status: 404,
        headers: { "set-cookie": "A=session; Path=/; Secure" },
      });
    }
    if (href.includes("/v1/test/getcrumb")) {
      return new Response("crumb-value", { status: 200 });
    }
    const isQuote = href.includes("/v7/finance/quote");
    return new Response(JSON.stringify(isQuote ? quote : chart), {
      status: isQuote ? (quoteStatus ?? status) : status,
    });
  });
}

/** Market-data calls only, without the cookie/crumb handshake. */
function upstream(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/finance/"));
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
    const calls = upstream(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/v7/finance/quote");
    expect(calls[0]).toContain("crumb=crumb-value");
    const quoteCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/v7/finance/quote"),
    ) as unknown[] | undefined;
    expect(
      (quoteCall?.[1] as { headers?: Record<string, string> })?.headers,
    ).toMatchObject({ Cookie: "A=session" });
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
    expect(upstream(fetchMock)).toHaveLength(1);
    const url = upstream(fetchMock)[0] ?? "";
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
    expect(upstream(fetchMock)).toHaveLength(1);
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

    expect(upstream(fetchMock)).toHaveLength(1);
  });

  it("replaces a cached spot quote when refresh is forced", async () => {
    let price = 47.11;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.startsWith("https://fc.yahoo.com")) {
        return new Response("", { headers: { "set-cookie": "A=1" } });
      }
      if (href.includes("/getcrumb")) return new Response("crumb");
      const body = quoteFixture([{ symbol: "PETR4.SA", price }]);
      price = 48.25;
      return new Response(JSON.stringify(body));
    });
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
    expect(upstream(fetchMock)).toHaveLength(2);
  });

  it("falls back to a short daily chart when the batch endpoint refuses", async () => {
    const fetchMock = stubYahoo({
      quote: {},
      quoteStatus: 401,
      chart: chartFixture(
        [
          { timestamp: unixDay("2026-09-03"), close: 45.25 },
          { timestamp: unixDay("2026-09-04"), close: 46.9 },
        ],
        47.11,
        unixDay("2026-09-04") + 15 * 3600,
      ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
    };

    const quote = await provider.getQuote(request);

    // Live delayed price from the chart meta, not the last stored daily bar.
    expect(quote).toMatchObject({
      price: "47.11000000",
      asOf: "2026-09-04",
      previousClose: "45.25000000",
      previousCloseAsOf: "2026-09-03",
    });
    const calls = upstream(fetchMock);
    // Refused once, retried with a renewed session, then one small chart.
    expect(calls.filter((url) => url.includes("/v7/"))).toHaveLength(2);
    const charts = calls.filter((url) => url.includes("/v8/finance/chart/"));
    expect(charts).toHaveLength(1);
    expect(charts[0]).toContain("range=5d");

    // The refusal pauses the batch path instead of retrying it every flush.
    await provider.getQuote({ ...request, forceRefresh: true });
    const later = upstream(fetchMock);
    expect(later.filter((url) => url.includes("/v7/"))).toHaveLength(2);
    expect(later.filter((url) => url.includes("/v8/"))).toHaveLength(2);
  });

  it("dates a live price traded after the last daily bar to its own session", async () => {
    vi.stubGlobal(
      "fetch",
      stubYahoo({
        quote: {},
        quoteStatus: 401,
        chart: chartFixture(
          [
            { timestamp: unixDay("2026-09-03"), close: 45.25 },
            { timestamp: unixDay("2026-09-04"), close: 46.9 },
          ],
          47.11,
          unixDay("2026-09-07") + 14 * 3600,
        ),
      }),
    );

    const quote = await new YahooProvider().getQuote({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
    });

    // Monday's bar is not published yet: Friday is the previous close.
    expect(quote).toMatchObject({
      price: "47.11000000",
      asOf: "2026-09-07",
      previousClose: "46.90000000",
      previousCloseAsOf: "2026-09-04",
    });
  });

  it("re-reads a same-day close until a later download settles it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-04T15:00:00Z"));
    const closes = [46.0, 46.5, 47.0];
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const close = closes[Math.min(reads, closes.length - 1)] ?? 0;
      reads += 1;
      return new Response(
        JSON.stringify(
          chartFixture([
            { timestamp: unixDay("2026-09-03"), close: 45.25 },
            { timestamp: unixDay("2026-09-04"), close },
          ]),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new YahooProvider();
    const request = {
      ticker: "PETR4",
      assetClass: "stock_br" as const,
      currency: "BRL" as const,
      asOf: "2026-09-04",
    };

    try {
      await expect(provider.getQuote(request)).resolves.toMatchObject({
        price: "46.00000000",
      });
      vi.setSystemTime(new Date("2026-09-04T15:20:00Z"));
      await expect(provider.getQuote(request)).resolves.toMatchObject({
        price: "46.00000000",
      });
      expect(fetchMock).toHaveBeenCalledOnce();

      // Past the short lifetime, the cached series is not trusted either.
      vi.setSystemTime(new Date("2026-09-04T15:31:00Z"));
      await expect(provider.getQuote(request)).resolves.toMatchObject({
        price: "46.50000000",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Downloaded the next day, the bar is final and kept.
      vi.setSystemTime(new Date("2026-09-05T10:00:00Z"));
      await expect(provider.getQuote(request)).resolves.toMatchObject({
        price: "47.00000000",
      });
      vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
      await provider.getQuote(request);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
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

    expect(upstream(fetchMock)).toHaveLength(2);
  });

  it("remembers a 404 but retries a rate limit or outage", async () => {
    const notFound = stubYahoo({ quote: {}, chart: {}, status: 404 });
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
    expect(upstream(notFound)).toHaveLength(2);

    clearQuoteCache();
    const rateLimited = stubYahoo({ quote: {}, chart: {}, status: 429 });
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
    expect(upstream(rateLimited).length).toBeGreaterThan(2);
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
