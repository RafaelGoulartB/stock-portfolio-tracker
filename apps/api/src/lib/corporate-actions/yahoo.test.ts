import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQuoteCache } from "../quotes/yahoo";
import { yahooPublishedSplits } from "./yahoo";

function unixDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 1_000);
}

function chartWithSplits(splits: Record<string, unknown>) {
  return {
    chart: {
      result: [
        {
          meta: { regularMarketPrice: 20, regularMarketTime: 1788552350 },
          timestamp: [unixDay("2025-03-03"), unixDay("2025-03-04")],
          indicators: { quote: [{ close: [40, 20] }] },
          events: { splits },
        },
      ],
      error: null,
    },
  };
}

function stubChart(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })),
  );
}

describe("yahooPublishedSplits", () => {
  beforeEach(() => clearQuoteCache());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Yahoo's numerator:denominator into from → to units", async () => {
    stubChart(
      chartWithSplits({
        a: { date: unixDay("2025-03-04"), numerator: 2, denominator: 1 },
        // A reverse split: ten old shares become one.
        b: { date: unixDay("2025-03-03"), numerator: 1, denominator: 10 },
        broken: { date: unixDay("2025-03-03"), numerator: 0, denominator: 1 },
      }),
    );

    const splits = await yahooPublishedSplits({
      ticker: "PETR4",
      assetClass: "stock_br",
      currency: "BRL",
      start: "2025-01-01",
      end: "2025-12-31",
    });

    expect(splits).toEqual([
      {
        effectiveAt: "2025-03-04",
        fromQuantity: "1.00000000",
        toQuantity: "2.00000000",
      },
      {
        effectiveAt: "2025-03-03",
        fromQuantity: "10.00000000",
        toQuantity: "1.00000000",
      },
    ]);
  });

  it("throws when Yahoo cannot answer instead of reporting no splits", async () => {
    stubChart({}, false);

    await expect(
      yahooPublishedSplits({
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
        start: "2025-01-01",
        end: "2025-12-31",
      }),
    ).rejects.toThrow();
  });
});
