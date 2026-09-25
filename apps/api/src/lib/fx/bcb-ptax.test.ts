import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BcbPtaxProvider, clearPtaxCache, parsePtaxSeries } from "./bcb-ptax";
import { tradeDateRates } from "./trade-rates";

function ptaxResponse(rows: unknown[]): Response {
  return new Response(JSON.stringify({ value: rows }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Thu 2026-09-17 and Fri 2026-09-18; the weekend has no PTAX. */
const WEEK = [
  { cotacaoVenda: 5.1521, dataHoraCotacao: "2026-09-17 13:03:21.858212" },
  { cotacaoVenda: 5.1575, dataHoraCotacao: "2026-09-18 13:03:34.742036" },
];

describe("parsePtaxSeries", () => {
  it("keeps the sell rate as an exact decimal string per day", () => {
    expect(parsePtaxSeries({ value: WEEK })).toEqual([
      { asOf: "2026-09-17", rate: "5.15210000" },
      { asOf: "2026-09-18", rate: "5.15750000" },
    ]);
  });

  it("skips malformed rows and never invents a zero rate", () => {
    expect(
      parsePtaxSeries({
        value: [
          { cotacaoVenda: 0, dataHoraCotacao: "2026-09-16 13:00:00" },
          { cotacaoVenda: "5.1", dataHoraCotacao: "2026-09-16 13:00:00" },
          { cotacaoVenda: 5.2, dataHoraCotacao: null },
          WEEK[0],
        ],
      }),
    ).toEqual([{ asOf: "2026-09-17", rate: "5.15210000" }]);
  });

  it("treats an empty range as an error, not as a quote", () => {
    expect(() => parsePtaxSeries({ value: [] })).toThrow(/no USD\/BRL rate/);
    expect(() => parsePtaxSeries({ error: "boom" })).toThrow(/unexpected/);
  });
});

describe("BCB PTAX provider", () => {
  beforeEach(() => clearPtaxCache());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a weekend to the previous business day's close", async () => {
    const fetchMock = vi.fn(async (_url: string) => ptaxResponse(WEEK));
    vi.stubGlobal("fetch", fetchMock);

    const quote = await new BcbPtaxProvider().getQuote({
      from: "USD",
      to: "BRL",
      asOf: "2026-09-20",
    });

    expect(quote).toEqual({
      from: "USD",
      to: "BRL",
      rate: "5.15750000",
      asOf: "2026-09-18",
      source: "bcb_ptax",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "%40dataFinalCotacao=%2709-20-2026%27",
    );
  });

  it("surfaces an upstream failure instead of a rate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );

    await expect(
      new BcbPtaxProvider().getQuote({
        from: "USD",
        to: "BRL",
        asOf: "2026-09-18",
      }),
    ).rejects.toThrow(/503/);
  });
});

describe("tradeDateRates", () => {
  beforeEach(() => clearPtaxCache());

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps every trade day to its PTAX in one request", async () => {
    const fetchMock = vi.fn(async () => ptaxResponse(WEEK));
    vi.stubGlobal("fetch", fetchMock);

    const rates = await tradeDateRates(
      ["2026-09-18", "2026-09-17", "2026-09-19", "2026-09-17"],
      "2026-09-25",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries(rates)).toEqual({
      "2026-09-17": { asOf: "2026-09-17", rate: "5.15210000" },
      "2026-09-18": { asOf: "2026-09-18", rate: "5.15750000" },
      // Saturday converts at Friday's PTAX.
      "2026-09-19": { asOf: "2026-09-18", rate: "5.15750000" },
    });
  });

  it("leaves today and future trades unresolved until PTAX is published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ptaxResponse(WEEK)),
    );

    const rates = await tradeDateRates(
      ["2026-09-18", "2026-09-21", "2026-09-30"],
      "2026-09-21",
    );

    // Monday's close is not out yet; Friday's must not be stored for it.
    expect([...rates.keys()]).toEqual(["2026-09-18"]);
  });
});
