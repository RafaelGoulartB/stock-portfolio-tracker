import { describe, expect, it } from "vitest";
import {
  availableQuantity,
  buildTickerLedger,
  type ConsolidationInput,
  consolidatePositions,
  convertMoney,
  convertPositions,
  filterTransactionsByAsOf,
  summarizePositions,
  type TickerLedgerEntry,
  tickerCurrencies,
  valuePositions,
} from "./positions";

let sequence = 0;

function tx(
  partial: Partial<ConsolidationInput> & Pick<ConsolidationInput, "side">,
): ConsolidationInput {
  sequence += 1;

  return {
    ticker: "PETR4",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "1",
    price: "10",
    fees: "0",
    tradedAt: "2026-01-01",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    ...partial,
  };
}

describe("consolidatePositions", () => {
  it("averages buy costs including fees", () => {
    const [position] = consolidatePositions([
      tx({ side: "buy", quantity: "100", price: "30", fees: "5" }),
      tx({ side: "buy", quantity: "50", price: "36", fees: "5" }),
    ]);

    expect(position).toMatchObject({
      ticker: "PETR4",
      quantity: "150.00000000",
      investedCost: "4810.00",
      averagePrice: "32.07",
      realizedPnl: "0.00",
      transactionCount: 2,
    });
  });

  it("releases cost at the average price on a partial sell", () => {
    const [position] = consolidatePositions([
      tx({ side: "buy", quantity: "100", price: "10" }),
      tx({ side: "sell", quantity: "40", price: "15", fees: "10" }),
    ]);

    expect(position).toMatchObject({
      quantity: "60.00000000",
      averagePrice: "10.00",
      investedCost: "600.00",
      realizedPnl: "190.00",
    });
  });

  it("zeroes the cost basis when the position is fully closed", () => {
    const [position] = consolidatePositions([
      tx({ side: "buy", quantity: "10", price: "100" }),
      tx({ side: "sell", quantity: "10", price: "120", fees: "20" }),
    ]);

    expect(position).toMatchObject({
      quantity: "0.00000000",
      averagePrice: "0.00",
      investedCost: "0.00",
      realizedPnl: "180.00",
    });
  });

  it("processes transactions in trade date order regardless of input order", () => {
    const [position] = consolidatePositions([
      tx({ side: "sell", quantity: "5", price: "20", tradedAt: "2026-02-10" }),
      tx({ side: "buy", quantity: "10", price: "10", tradedAt: "2026-01-05" }),
    ]);

    expect(position).toMatchObject({
      quantity: "5.00000000",
      averagePrice: "10.00",
      realizedPnl: "50.00",
      lastTradedAt: "2026-02-10",
    });
  });

  it("keeps fractional quantities exact", () => {
    const [position] = consolidatePositions([
      tx({
        ticker: "BTC",
        assetClass: "crypto",
        side: "buy",
        quantity: "0.00500000",
        price: "350000",
      }),
    ]);

    expect(position).toMatchObject({
      ticker: "BTC",
      quantity: "0.00500000",
      investedCost: "1750.00",
      averagePrice: "350000.00",
    });
  });

  it("groups by ticker and sorts alphabetically", () => {
    const positions = consolidatePositions([
      tx({ ticker: "VALE3", side: "buy" }),
      tx({ ticker: "ITUB4", side: "buy" }),
    ]);

    expect(positions.map((position) => position.ticker)).toEqual([
      "ITUB4",
      "VALE3",
    ]);
  });
});

function ledgerTx(
  partial: Partial<TickerLedgerEntry> & Pick<TickerLedgerEntry, "side">,
): TickerLedgerEntry {
  const base = tx(partial);

  return {
    ...base,
    id: `trade-${base.createdAt.getTime()}`,
    notes: partial.notes ?? null,
    ...partial,
  };
}

describe("buildTickerLedger", () => {
  it("returns an empty ledger when the ticker has no trades", () => {
    expect(buildTickerLedger("PETR4", [])).toMatchObject({
      ticker: "PETR4",
      currency: null,
      trades: [],
      buyCount: 0,
      sellCount: 0,
      realizedPnl: "0.00",
      investedCost: "0.00",
    });
  });

  it("books realized P&L on a sell at the moving average", () => {
    const ledger = buildTickerLedger("PETR4", [
      ledgerTx({ side: "buy", quantity: "100", price: "10" }),
      ledgerTx({
        side: "sell",
        quantity: "40",
        price: "15",
        fees: "10",
        tradedAt: "2026-01-02",
      }),
    ]);

    expect(ledger).toMatchObject({
      currency: "BRL",
      buyCount: 1,
      sellCount: 1,
      buyTotal: "1000.00",
      sellTotal: "590.00",
      realizedPnl: "190.00",
      investedCost: "600.00",
      quantity: "60.00000000",
      averagePrice: "10.00",
    });
    expect(ledger.trades).toHaveLength(2);
    expect(ledger.trades[0]).toMatchObject({
      side: "sell",
      realizedPnl: "190.00",
      quantityAfter: "60.00000000",
      averagePriceAfter: "10.00",
    });
    expect(ledger.trades[1]).toMatchObject({
      side: "buy",
      realizedPnl: null,
      quantityAfter: "100.00000000",
      averagePriceAfter: "10.00",
    });
  });

  it("matches consolidatePositions realized P&L across several sells", () => {
    const rows = [
      ledgerTx({ side: "buy", quantity: "10", price: "100" }),
      ledgerTx({
        side: "sell",
        quantity: "4",
        price: "120",
        tradedAt: "2026-01-02",
      }),
      ledgerTx({
        side: "buy",
        quantity: "6",
        price: "80",
        tradedAt: "2026-01-03",
      }),
      ledgerTx({
        side: "sell",
        quantity: "5",
        price: "90",
        tradedAt: "2026-01-04",
      }),
    ];
    const [position] = consolidatePositions(rows);
    const ledger = buildTickerLedger("PETR4", rows);

    expect(ledger.realizedPnl).toBe(position?.realizedPnl);
    expect(ledger.investedCost).toBe(position?.investedCost);
    expect(ledger.quantity).toBe(position?.quantity);
    expect(
      ledger.trades
        .filter((trade) => trade.realizedPnl !== null)
        .reduce((sum, trade) => sum + Number(trade.realizedPnl), 0)
        .toFixed(2),
    ).toBe(ledger.realizedPnl);
  });
});

describe("summarizePositions", () => {
  it("totals invested cost and realized P&L in the display currency", () => {
    const native = consolidatePositions([
      tx({ ticker: "ITUB4", side: "buy", quantity: "100", price: "20" }),
      tx({ ticker: "VALE3", side: "buy", quantity: "10", price: "60" }),
      tx({ ticker: "VALE3", side: "sell", quantity: "10", price: "70" }),
    ]);
    const positions = convertPositions(native, "BRL", null);

    expect(summarizePositions(positions, "BRL", null)).toEqual({
      openPositions: 1,
      closedPositions: 1,
      displayCurrency: "BRL",
      usdBrlRate: null,
      totalInvested: "2000.00",
      totalRealizedPnl: "100.00",
      totalsByCurrency: [
        { currency: "BRL", investedCost: "2000.00", realizedPnl: "100.00" },
      ],
      asOf: null,
      totalMarketValue: "0.00",
      quotedInvestedCost: "0.00",
      totalUnrealizedPnl: "0.00",
      totalUnrealizedPnlPercent: null,
      quotedPositions: 0,
      unquotedPositions: 1,
    });
  });

  it("converts foreign positions at the consolidation rate", () => {
    const native = consolidatePositions([
      tx({ ticker: "ITUB4", side: "buy", quantity: "100", price: "20" }),
      tx({
        ticker: "AAPL",
        assetClass: "stock_us",
        currency: "USD",
        side: "buy",
        quantity: "10",
        price: "200",
      }),
    ]);
    const positions = convertPositions(native, "BRL", "5");

    expect(summarizePositions(positions, "BRL", "5")).toMatchObject({
      displayCurrency: "BRL",
      usdBrlRate: "5",
      // 2000 BRL + 2000 USD * 5.
      totalInvested: "12000.00",
      totalsByCurrency: [
        { currency: "BRL", investedCost: "2000.00", realizedPnl: "0.00" },
        { currency: "USD", investedCost: "2000.00", realizedPnl: "0.00" },
      ],
    });
    expect(
      positions.find((position) => position.ticker === "AAPL"),
    ).toMatchObject({
      currency: "USD",
      displayCurrency: "BRL",
      investedCost: "2000.00",
      convertedInvestedCost: "10000.00",
    });
  });
});

describe("multi-currency consolidation", () => {
  it("never averages BRL and USD costs of the same ticker together", () => {
    const positions = consolidatePositions([
      tx({ side: "buy", quantity: "10", price: "30" }),
      tx({
        side: "buy",
        currency: "USD",
        quantity: "10",
        price: "30",
        tradedAt: "2026-01-02",
      }),
    ]);

    expect(positions).toHaveLength(2);
    expect(positions.map((position) => position.currency).sort()).toEqual([
      "BRL",
      "USD",
    ]);
  });

  it("requires a rate only when holdings span both currencies", () => {
    const single = consolidatePositions([tx({ side: "buy" })]);

    expect(() => convertPositions(single, "BRL", null)).not.toThrow();

    const mixed = consolidatePositions([
      tx({ side: "buy" }),
      tx({ side: "buy", currency: "USD", tradedAt: "2026-01-02" }),
    ]);

    expect(() => convertPositions(mixed, "BRL", null)).toThrow();
  });

  it("converts amounts through the USD/BRL rate", () => {
    expect(convertMoney("2000.00", "USD", "BRL", "5")).toBe("10000.00");
    expect(convertMoney("10000.00", "BRL", "USD", "5")).toBe("2000.00");
    expect(convertMoney("100.00", "BRL", "BRL", "5")).toBe("100.00");
  });
});

describe("availableQuantity", () => {
  it("reports what is left to sell", () => {
    const log = [
      tx({ side: "buy", quantity: "30", price: "10" }),
      tx({ side: "sell", quantity: "12", price: "11" }),
    ];

    expect(availableQuantity(log, "PETR4")).toBe("18.00000000");
    expect(availableQuantity(log, "MGLU3")).toBe("0.00000000");
  });
});

describe("tickerCurrencies", () => {
  it("lists the currencies already used by a ticker", () => {
    const log = [tx({ side: "buy" })];

    expect(tickerCurrencies(log, "PETR4")).toEqual(["BRL"]);
    expect(tickerCurrencies(log, "AAPL")).toEqual([]);
  });
});

describe("filterTransactionsByAsOf", () => {
  it("keeps only trades on or before the snapshot day", () => {
    const log = [
      tx({ side: "buy", quantity: "10", tradedAt: "2024-03-04" }),
      tx({ side: "buy", quantity: "5", tradedAt: "2024-11-18" }),
    ];

    expect(filterTransactionsByAsOf(log, null)).toHaveLength(2);
    expect(filterTransactionsByAsOf(log, "2024-06-30")).toHaveLength(1);
    expect(filterTransactionsByAsOf(log, "2024-03-04")).toHaveLength(1);
  });
});

describe("valuePositions", () => {
  it("values open positions and weights them by quoted equity", () => {
    const native = consolidatePositions([
      tx({ ticker: "ITUB4", side: "buy", quantity: "100", price: "20" }),
      tx({ ticker: "VALE3", side: "buy", quantity: "10", price: "60" }),
    ]);
    const positions = convertPositions(native, "BRL", null);
    const valued = valuePositions(
      positions,
      new Map(
        [
          { ticker: "ITUB4", price: "30", asOf: "2024-06-28" },
          { ticker: "VALE3", price: "70", asOf: "2024-06-28" },
        ].map((quote) => [quote.ticker, quote]),
      ),
      "BRL",
      null,
    );

    expect(valued.find((p) => p.ticker === "ITUB4")).toMatchObject({
      marketPrice: "30.00",
      marketValue: "3000.00",
      convertedMarketValue: "3000.00",
      // 3000 market value against a 2000 cost basis.
      unrealizedPnl: "1000.00",
      convertedUnrealizedPnl: "1000.00",
      unrealizedPnlPercent: "0.500000",
      quoteMissing: false,
    });

    const weights = valued.reduce((sum, p) => sum + Number(p.weight ?? 0), 0);
    expect(weights).toBeCloseTo(1, 6);
    expect(summarizePositions(valued, "BRL", null, "2024-06-30")).toMatchObject(
      {
        asOf: "2024-06-30",
        totalMarketValue: "3700.00",
        quotedInvestedCost: "2600.00",
        totalUnrealizedPnl: "1100.00",
        totalUnrealizedPnlPercent: "0.423077",
        quotedPositions: 2,
        unquotedPositions: 0,
      },
    );
  });

  it("keeps the open result negative when the quote is below the average cost", () => {
    const native = consolidatePositions([
      tx({
        ticker: "AAPL",
        assetClass: "stock_us",
        currency: "USD",
        side: "buy",
        quantity: "10",
        price: "200",
      }),
    ]);
    const [valued] = valuePositions(
      convertPositions(native, "BRL", "5"),
      new Map([["AAPL", { ticker: "AAPL", price: "180", asOf: "2024-06-28" }]]),
      "BRL",
      "5",
    );

    expect(valued).toMatchObject({
      marketValue: "1800.00",
      convertedMarketValue: "9000.00",
      unrealizedPnl: "-200.00",
      convertedUnrealizedPnl: "-1000.00",
      unrealizedPnlPercent: "-0.100000",
    });
  });

  it("keeps a fixed-income balance out of calculated returns", () => {
    const native = consolidatePositions([
      tx({
        ticker: "TESOURO SELIC 2031",
        assetClass: "fixed_income",
        side: "buy",
        quantity: "1",
        price: "10000",
      }),
    ]);
    const [valued] = valuePositions(
      convertPositions(native, "BRL", null),
      new Map([
        [
          "TESOURO SELIC 2031",
          { ticker: "TESOURO SELIC 2031", price: "10500", asOf: "2026-09-07" },
        ],
      ]),
      "BRL",
      null,
    );

    expect(valued).toMatchObject({
      marketValue: "10500.00",
      unrealizedPnl: null,
      convertedUnrealizedPnl: null,
      unrealizedPnlPercent: null,
    });
    expect(summarizePositions([valued], "BRL", null)).toMatchObject({
      totalMarketValue: "10500.00",
      quotedInvestedCost: "0.00",
      totalUnrealizedPnl: "0.00",
      totalUnrealizedPnlPercent: null,
    });
  });

  it("flags tickers without a quote instead of guessing", () => {
    const native = consolidatePositions([
      tx({ ticker: "ITUB4", side: "buy", quantity: "100", price: "20" }),
    ]);
    const [valued] = valuePositions(
      convertPositions(native, "BRL", null),
      new Map(),
      "BRL",
      null,
    );

    expect(valued).toMatchObject({
      marketValue: null,
      weight: null,
      unrealizedPnl: null,
      convertedUnrealizedPnl: null,
      unrealizedPnlPercent: null,
      quoteMissing: true,
    });
    expect(
      summarizePositions([valued], "BRL", null, "2024-06-30"),
    ).toMatchObject({
      totalMarketValue: "0.00",
      quotedInvestedCost: "0.00",
      totalUnrealizedPnl: "0.00",
      totalUnrealizedPnlPercent: null,
      quotedPositions: 0,
      unquotedPositions: 1,
    });
  });
});
