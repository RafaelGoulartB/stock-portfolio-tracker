import { describe, expect, it } from "vitest";
import { performanceSnapshots } from "./performance";
import {
  type ConsolidationInput,
  consolidatePositions,
  consolidatePositionsAtEach,
  filterTransactionsByAsOf,
} from "./positions";

/**
 * `consolidatePositionsAtEach` replaced one full re-consolidation per month
 * end with a single ledger walk. It is the input to every value on the
 * performance chart, so it is pinned against the obvious implementation it
 * replaced rather than against expected numbers written by hand.
 */
function naiveSnapshots(
  transactions: readonly ConsolidationInput[],
  asOfDates: readonly string[],
) {
  return asOfDates.map((asOf) =>
    consolidatePositions(filterTransactionsByAsOf(transactions, asOf)),
  );
}

/** Deterministic PRNG so a failure is always reproducible. */
function random(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;

    return state / 0x1_0000_0000;
  };
}

const TICKERS = [
  { ticker: "PETR4", assetClass: "stock_br", currency: "BRL" },
  { ticker: "ITUB4", assetClass: "stock_br", currency: "BRL" },
  { ticker: "AAPL", assetClass: "stock_us", currency: "USD" },
  { ticker: "HGLG11", assetClass: "reit", currency: "BRL" },
  { ticker: "BTC", assetClass: "crypto", currency: "USD" },
] as const;

function ledger(seed: number, count: number): ConsolidationInput[] {
  const next = random(seed);
  const rows: ConsolidationInput[] = [];

  for (let index = 0; index < count; index += 1) {
    const asset = TICKERS[Math.floor(next() * TICKERS.length)];
    const day = new Date(
      Date.UTC(2024, 0, 1 + Math.floor(next() * 900)),
    ).toISOString();

    rows.push({
      ticker: asset.ticker,
      assetClass: asset.assetClass,
      currency: asset.currency,
      // Sells are rarer than buys, and oversell is clamped by applyTrade.
      side: next() < 0.28 ? "sell" : "buy",
      quantity: (1 + Math.floor(next() * 90)).toFixed(8),
      price: (1 + next() * 300).toFixed(8),
      fees: (next() * 12).toFixed(8),
      tradedAt: day.slice(0, 10),
      createdAt: new Date(day),
    });
  }

  return rows;
}

function tradeOrder(rows: ConsolidationInput[]): ConsolidationInput[] {
  return [...rows].sort(
    (a, b) =>
      a.tradedAt.localeCompare(b.tradedAt) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

describe("consolidatePositionsAtEach", () => {
  const dates = performanceSnapshots(
    36,
    new Date("2026-09-08T15:00:00.000Z"),
  ).map((snapshot) => snapshot.asOf);

  it("matches per-date consolidation on ordered ledgers", () => {
    for (const seed of [1, 7, 99, 12_345]) {
      const rows = tradeOrder(ledger(seed, 400));

      expect(consolidatePositionsAtEach(rows, dates)).toEqual(
        naiveSnapshots(rows, dates),
      );
    }
  });

  it("matches per-date consolidation on unordered ledgers", () => {
    for (const seed of [2, 23, 404] as const) {
      // Deliberately not sorted: the walk must order the log itself.
      const rows = ledger(seed, 400);

      expect(consolidatePositionsAtEach(rows, dates)).toEqual(
        naiveSnapshots(rows, dates),
      );
    }
  });

  it("matches when trades are backdated behind existing history", () => {
    const rows = tradeOrder(ledger(55, 200));
    const backdated: ConsolidationInput[] = [
      ...rows,
      {
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "500.00000000",
        price: "20.00000000",
        fees: "1.00000000",
        tradedAt: "2024-02-05",
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
      },
      {
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
        side: "sell",
        quantity: "120.00000000",
        price: "34.00000000",
        fees: "2.00000000",
        tradedAt: "2024-03-11",
        createdAt: new Date("2026-09-01T10:00:01.000Z"),
      },
    ];

    expect(consolidatePositionsAtEach(backdated, dates)).toEqual(
      naiveSnapshots(backdated, dates),
    );
  });

  it("matches on an empty ledger and on dates before any trade", () => {
    expect(consolidatePositionsAtEach([], dates)).toEqual(
      naiveSnapshots([], dates),
    );

    const rows = tradeOrder(ledger(9, 40));
    const early = ["2019-01-31", "2019-02-28", ...dates];

    expect(consolidatePositionsAtEach(rows, early)).toEqual(
      naiveSnapshots(rows, early),
    );
  });

  it("keeps one currency per group when a ticker changed currency", () => {
    const rows: ConsolidationInput[] = [
      {
        ticker: "XPTO",
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10.00000000",
        price: "10.00000000",
        fees: "0.00000000",
        tradedAt: "2025-01-10",
        createdAt: new Date("2025-01-10T10:00:00.000Z"),
      },
      {
        ticker: "XPTO",
        assetClass: "stock_us",
        currency: "USD",
        side: "buy",
        quantity: "5.00000000",
        price: "40.00000000",
        fees: "1.00000000",
        tradedAt: "2025-02-10",
        createdAt: new Date("2025-02-10T10:00:00.000Z"),
      },
    ];

    const snapshots = consolidatePositionsAtEach(rows, dates);

    expect(snapshots).toEqual(naiveSnapshots(rows, dates));
    expect(
      snapshots.at(-1)?.filter((row) => row.ticker === "XPTO"),
    ).toHaveLength(2);
  });
});

describe("consolidatePositions ordering", () => {
  it("produces the same result whatever the input order", () => {
    const rows = ledger(31, 300);

    expect(consolidatePositions(rows)).toEqual(
      consolidatePositions(tradeOrder(rows)),
    );
  });

  it("does not mutate the caller's array", () => {
    const rows = ledger(41, 50);
    const before = rows.map((row) => `${row.ticker}|${row.tradedAt}`);

    consolidatePositions(rows);

    expect(rows.map((row) => `${row.ticker}|${row.tradedAt}`)).toEqual(before);
  });
});
