import { describe, expect, it } from "vitest";
import {
  buildPerformanceHistory,
  createSeriesLookup,
  type PerformanceBuildInput,
  performanceSnapshots,
} from "./performance";
import { type ConsolidationInput, tradeCashTotal } from "./positions";

let sequence = 0;

function tx(
  partial: Partial<ConsolidationInput> & Pick<ConsolidationInput, "side">,
): ConsolidationInput {
  sequence += 1;

  return {
    ticker: "ACME",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "100",
    price: "10",
    fees: "0",
    tradedAt: "2026-01-15",
    createdAt: new Date(Date.UTC(2026, 0, 15, 0, 0, sequence)),
    ...partial,
  };
}

/** Noon UTC keeps the API timezone on the same calendar day. */
function at(day: string): Date {
  return new Date(`${day}T15:00:00.000Z`);
}

function build(
  transactions: ConsolidationInput[],
  prices: Record<string, Record<string, string>>,
  options: Partial<PerformanceBuildInput> & {
    months?: number;
    now?: string;
  } = {},
) {
  const { months = 2, now = "2026-03-31", ...overrides } = options;

  return buildPerformanceHistory({
    transactions,
    snapshots: performanceSnapshots(months, at(now)),
    displayCurrency: "BRL",
    priceAt: (ticker, day) => prices[ticker]?.[day] ?? null,
    rateAt: () => "5",
    ...overrides,
  });
}

describe("performanceSnapshots", () => {
  it("ends today and prepends one baseline month-end", () => {
    const snapshots = performanceSnapshots(2, at("2026-03-15"));

    expect(snapshots).toEqual([
      { key: "2026-01", asOf: "2026-01-31", baseline: true },
      { key: "2026-02", asOf: "2026-02-28", baseline: false },
      { key: "2026-03", asOf: "2026-03-15", baseline: false },
    ]);
  });

  it("walks across year boundaries", () => {
    const keys = performanceSnapshots(3, at("2026-02-10")).map(
      (snapshot) => snapshot.asOf,
    );

    expect(keys).toEqual([
      "2025-11-30",
      "2025-12-31",
      "2026-01-31",
      "2026-02-10",
    ]);
  });
});

describe("createSeriesLookup", () => {
  const lookup = createSeriesLookup([
    { asOf: "2026-01-30", close: "9" },
    { asOf: "2026-02-27", close: "11" },
  ]);

  it("carries the last close forward over weekends and holidays", () => {
    expect(lookup("2026-01-31")?.close).toBe("9");
    expect(lookup("2026-02-28")?.close).toBe("11");
  });

  it("has no value before the series starts", () => {
    expect(lookup("2026-01-29")).toBeNull();
  });
});

describe("buildPerformanceHistory", () => {
  const holding = [tx({ side: "buy", quantity: "100", price: "10" })];
  const prices = {
    ACME: {
      "2026-01-31": "10",
      "2026-02-28": "11",
      "2026-03-31": "12",
    },
  };

  it("compounds monthly returns into the window return", () => {
    const history = build(holding, prices);

    expect(history.months.map((month) => month.monthlyReturn)).toEqual([
      "0.100000",
      "0.090909",
    ]);
    expect(history.months.map((month) => month.marketValue)).toEqual([
      "1100.00",
      "1200.00",
    ]);
    expect(history.summary.cumulativeReturn).toBe("0.200000");
    expect(history.summary.monthsWithReturn).toBe(2);
    expect(history.summary.positiveMonths).toBe(2);
  });

  it("weights a mid-month contribution by the days it was invested", () => {
    const history = build(
      [
        tx({ side: "buy", quantity: "100", price: "10" }),
        tx({
          side: "buy",
          quantity: "100",
          price: "11",
          tradedAt: "2026-02-14",
        }),
      ],
      { ACME: { "2026-01-31": "10", "2026-02-28": "12", "2026-03-31": "12" } },
      { months: 1, now: "2026-02-28" },
    );
    const [february] = history.months;

    // Gain 2400 - 1000 - 1100 = 300 over a base of 1000 + 1100 * 0.5.
    expect(february.netFlow).toBe("1100.00");
    expect(february.marketValue).toBe("2400.00");
    expect(february.monthlyReturn).toBe("0.193548");
  });

  it("ignores contributions when measuring the return", () => {
    // Doubling the position at the same price must not create a return.
    const flat = build(
      [
        tx({ side: "buy", quantity: "100", price: "10" }),
        tx({
          side: "buy",
          quantity: "100",
          price: "10",
          tradedAt: "2026-02-10",
        }),
      ],
      { ACME: { "2026-01-31": "10", "2026-02-28": "10" } },
      { months: 1, now: "2026-02-28" },
    );

    expect(flat.months[0].monthlyReturn).toBe("0.000000");
    expect(flat.months[0].cumulativeReturn).toBe("0.000000");
  });

  it("tracks the drawdown from the peak of the compounded curve", () => {
    const history = build(
      holding,
      { ACME: { "2026-01-31": "10", "2026-02-28": "12", "2026-03-31": "9" } },
      { months: 2 },
    );

    expect(history.months.map((month) => month.drawdown)).toEqual([
      "0.000000",
      "-0.250000",
    ]);
    expect(history.summary.maxDrawdown).toBe("-0.250000");
    expect(history.summary.worstMonth).toMatchObject({
      key: "2026-03",
      returnPercent: "-0.250000",
    });
    expect(history.summary.bestMonth).toMatchObject({ key: "2026-02" });
  });

  it("carries positions without a quote at cost and counts them", () => {
    const history = build(
      [
        tx({ side: "buy", quantity: "100", price: "10" }),
        tx({
          ticker: "CDB",
          assetClass: "fixed_income",
          side: "buy",
          quantity: "1",
          price: "500",
        }),
      ],
      prices,
      { months: 1, now: "2026-02-28" },
    );
    const [february] = history.months;

    expect(february.marketValue).toBe("1600.00");
    expect(february.costFallbackValue).toBe("500.00");
    expect(february.unquotedPositions).toBe(1);
    expect(history.summary.unquotedPositions).toBe(1);
    expect(
      history.byAsset.find((asset) => asset.ticker === "CDB"),
    ).toMatchObject({ quoteMissing: true, unrealizedPnl: "0.00" });
  });

  it("breaks the last snapshot down by asset class", () => {
    const history = build(
      [
        tx({ side: "buy", quantity: "100", price: "10" }),
        tx({
          ticker: "HGLG11",
          assetClass: "reit",
          side: "buy",
          quantity: "10",
          price: "100",
        }),
      ],
      {
        ACME: { "2026-02-28": "11" },
        HGLG11: { "2026-02-28": "120" },
      },
      { months: 1, now: "2026-02-28" },
    );

    expect(history.byAssetClass).toEqual([
      expect.objectContaining({
        assetClass: "reit",
        marketValue: "1200.00",
        investedCost: "1000.00",
        unrealizedPnl: "200.00",
        unrealizedPnlPercent: "0.200000",
        weight: "0.521739",
        contribution: "0.100000",
        positions: 1,
      }),
      expect.objectContaining({
        assetClass: "stock_br",
        marketValue: "1100.00",
        unrealizedPnl: "100.00",
        weight: "0.478261",
      }),
    ]);
  });

  it("converts foreign holdings at the rate of each snapshot", () => {
    const history = build(
      [
        tx({
          ticker: "AAPL",
          assetClass: "stock_us",
          currency: "USD",
          side: "buy",
          quantity: "10",
          price: "100",
        }),
      ],
      { AAPL: { "2026-01-31": "100", "2026-02-28": "100" } },
      {
        months: 1,
        now: "2026-02-28",
        rateAt: (day) => (day >= "2026-02-01" ? "6" : "5"),
      },
    );
    const [february] = history.months;

    // The asset is flat in USD; the whole return comes from the FX move.
    expect(february.marketValue).toBe("6000.00");
    expect(february.monthlyReturn).toBe("0.200000");
    expect(february.usdBrlRate).toBe("6");
  });

  it("books realized results inside the window only", () => {
    const history = build(
      [
        tx({ side: "buy", quantity: "100", price: "10" }),
        tx({
          side: "sell",
          quantity: "50",
          price: "12",
          tradedAt: "2026-02-10",
        }),
      ],
      { ACME: { "2026-01-31": "10", "2026-02-28": "12" } },
      { months: 1, now: "2026-02-28" },
    );

    expect(history.months[0].realizedPnl).toBe("100.00");
    expect(history.summary.realizedPnl).toBe("100.00");
    expect(history.months[0].netFlow).toBe("-600.00");
  });

  it("leaves the return undefined while there is nothing invested", () => {
    const history = build(
      [tx({ side: "buy", tradedAt: "2026-03-10" })],
      { ACME: { "2026-03-31": "10" } },
      { months: 2 },
    );

    expect(history.months[0].monthlyReturn).toBeNull();
    expect(history.months[0].cumulativeReturn).toBeNull();
    expect(history.months[1].monthlyReturn).not.toBeNull();
    expect(history.summary.monthsWithReturn).toBe(1);
  });

  it("annualizes only windows of at least six months", () => {
    const short = build(holding, prices, { months: 2 });

    expect(short.summary.annualizedReturn).toBeNull();
  });
});

/**
 * Month flows moved from one scan of the ledger per month to a single pass.
 * The values are pinned against an independent sum so the single pass cannot
 * drift on month boundaries, backdated trades or a rate that changes by day.
 */
describe("month flows", () => {
  function flowLedger(): ConsolidationInput[] {
    return [
      // Before the window: must not reach any month.
      tx({ side: "buy", tradedAt: "2025-11-20", quantity: "10", price: "10" }),
      // Exactly on the baseline month end: still outside the window.
      tx({ side: "buy", tradedAt: "2025-12-31", quantity: "5", price: "20" }),
      // First day inside the first month.
      tx({ side: "buy", tradedAt: "2026-01-01", quantity: "7", price: "30" }),
      tx({
        side: "buy",
        tradedAt: "2026-01-31",
        quantity: "3",
        price: "40",
        fees: "1.50",
      }),
      tx({
        side: "sell",
        tradedAt: "2026-02-10",
        quantity: "4",
        price: "50",
        fees: "2.25",
      }),
      // USD trade, converted at its own trade-day rate.
      tx({
        side: "buy",
        ticker: "AAPL",
        assetClass: "stock_us",
        currency: "USD",
        tradedAt: "2026-02-20",
        quantity: "2",
        price: "100",
      }),
      tx({ side: "buy", tradedAt: "2026-03-05", quantity: "1", price: "60" }),
      // Backdated write into an earlier month of the window.
      tx({ side: "buy", tradedAt: "2026-01-15", quantity: "2", price: "25" }),
    ];
  }

  /** BRL per USD, deliberately different per day. */
  const rateByDay: Record<string, string> = {
    "2026-02-20": "5.5",
    "2026-02-28": "5.6",
  };
  const rateAt = (day: string) => rateByDay[day] ?? "5";

  function expectedNetFlow(
    transactions: ConsolidationInput[],
    previous: string,
    current: string,
  ): number {
    let total = 0;

    for (const entry of transactions) {
      if (entry.tradedAt <= previous || entry.tradedAt > current) {
        continue;
      }

      const cash = Number(tradeCashTotal(entry));
      const signed = entry.side === "buy" ? cash : -cash;
      const rate =
        entry.currency === "BRL"
          ? 1
          : Number(rateAt(entry.tradedAt) ?? rateAt(current));

      total += signed * rate;
    }

    return total;
  }

  it("assigns every trade to exactly one month of the window", () => {
    const transactions = flowLedger();
    const snapshots = performanceSnapshots(3, at("2026-03-31"));
    const history = buildPerformanceHistory({
      transactions,
      snapshots,
      displayCurrency: "BRL",
      priceAt: () => "45",
      rateAt,
    });

    expect(history.months.map((month) => month.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);

    let previous = snapshots[0].asOf;

    for (const month of history.months) {
      expect(Number(month.netFlow)).toBeCloseTo(
        expectedNetFlow(transactions, previous, month.asOf),
        2,
      );
      previous = month.asOf;
    }

    // Nothing before the baseline leaked in, and the window sums up.
    const windowTotal = history.months.reduce(
      (sum, month) => sum + Number(month.netFlow),
      0,
    );

    expect(Number(history.months.at(-1)?.cumulativeNetFlow)).toBeCloseTo(
      windowTotal,
      2,
    );
    expect(windowTotal).toBeCloseTo(
      expectedNetFlow(transactions, snapshots[0].asOf, "2026-03-31"),
      2,
    );
  });

  it("is unaffected by the order the ledger arrives in", () => {
    const transactions = flowLedger();
    const shuffled = [...transactions].reverse();
    const options = {
      snapshots: performanceSnapshots(3, at("2026-03-31")),
      displayCurrency: "BRL" as const,
      priceAt: () => "45",
      rateAt,
    };

    expect(
      buildPerformanceHistory({ ...options, transactions: shuffled }),
    ).toEqual(buildPerformanceHistory({ ...options, transactions }));
  });
});
