import { describe, expect, it, vi } from "vitest";
import {
  AlphaVantageResultProvider,
  parseAlphaVantageCalendar,
} from "./alpha-vantage";

const asset = {
  ticker: "AAPL",
  assetClass: "stock_us",
  currency: "USD",
} as const;

function csvResponse(csv: string): Response {
  return new Response(csv, {
    status: 200,
    headers: { "content-type": "text/csv" },
  });
}

describe("parseAlphaVantageCalendar", () => {
  it("normalizes headers, ignores invalid dates and deduplicates rows", () => {
    const parsed = parseAlphaVantageCalendar(`symbol,reportDate,name
AAPL,2026-10-30,Apple
AAPL,2026-10-30,Apple
AAPL,2026-02-30,Apple
MSFT,2026-11-01,Microsoft
`);

    expect(parsed.get("AAPL")).toEqual(["2026-10-30"]);
    expect(parsed.get("MSFT")).toEqual(["2026-11-01"]);
  });
});

describe("AlphaVantageResultProvider", () => {
  it("keeps a future date when the same ticker also has a past row", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      csvResponse(`symbol,reportDate
AAPL,2026-01-15
AAPL,2026-10-30
`),
    );
    const provider = new AlphaVantageResultProvider("key", fetchMock);

    await expect(provider.getNextResult(asset, "2026-09-08")).resolves.toEqual({
      ticker: "AAPL",
      date: "2026-10-30",
      period: null,
      source: "alpha_vantage",
      estimated: false,
    });
  });

  it("shares and caches the calendar across ticker requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      csvResponse(`symbol,reportDate
AAPL,2026-10-30
MSFT,2026-11-01
`),
    );
    const provider = new AlphaVantageResultProvider("key", fetchMock);

    await Promise.all([
      provider.getNextResult(asset, "2026-09-08"),
      provider.getNextResult(
        { ticker: "MSFT", assetClass: "stock_us", currency: "USD" },
        "2026-09-08",
      ),
    ]);
    await provider.getNextResult(asset, "2026-09-08");

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a JSON quota response instead of parsing it as CSV", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ Note: "quota reached" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new AlphaVantageResultProvider("key", fetchMock);

    await expect(provider.getNextResult(asset, "2026-09-08")).rejects.toThrow(
      "did not return an earnings calendar",
    );
  });

  it("does not call the provider when no API key is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new AlphaVantageResultProvider(undefined, fetchMock);

    await expect(
      provider.getNextResult(asset, "2026-09-08"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
