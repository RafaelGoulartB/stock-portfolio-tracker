import type { ValuedPosition } from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  type AllocationAssetMeta,
  buildAllocationRows,
  lastContributions,
  summarizeAllocation,
} from "./allocation";
import type { ConsolidationInput } from "./positions";

const TODAY = "2026-09-06";

function position(overrides: Partial<ValuedPosition> = {}): ValuedPosition {
  return {
    ticker: "DLO",
    assetClass: "stock_us",
    currency: "USD",
    quantity: "50.00000000",
    averagePrice: "10.00",
    investedCost: "500.00",
    realizedPnl: "0.00",
    transactionCount: 1,
    lastTradedAt: "2026-01-10",
    displayCurrency: "BRL",
    convertedAveragePrice: "50.00",
    convertedInvestedCost: "2500.00",
    convertedRealizedPnl: "0.00",
    marketPrice: "12.00",
    marketValue: "600.00",
    convertedMarketValue: "3000.00",
    unrealizedPnl: "100.00",
    convertedUnrealizedPnl: "500.00",
    unrealizedPnlPercent: "0.200000",
    weight: "0.01460000",
    quoteAsOf: "2026-09-04",
    quoteMissing: false,
    ...overrides,
  };
}

function asset(
  overrides: Partial<AllocationAssetMeta> = {},
): AllocationAssetMeta {
  return {
    ticker: "DLO",
    assetClass: "stock_us",
    currency: "USD",
    targetWeight: "0.015",
    discount: "0.2355",
    valuationRef: "1Q26",
    sortOrder: 1,
    ...overrides,
  };
}

function trade(
  overrides: Partial<ConsolidationInput> = {},
): ConsolidationInput {
  return {
    ticker: "DLO",
    assetClass: "stock_us",
    currency: "USD",
    side: "buy",
    quantity: "10",
    price: "10",
    fees: "0",
    tradedAt: "2026-01-10",
    createdAt: new Date("2026-01-10T12:00:00Z"),
    ...overrides,
  };
}

describe("lastContributions", () => {
  it("keeps the newest buy per ticker and ignores sells", () => {
    const result = lastContributions([
      trade({ tradedAt: "2026-01-10" }),
      trade({ tradedAt: "2026-04-02" }),
      trade({ tradedAt: "2026-08-30", side: "sell" }),
      trade({ ticker: "VOO", tradedAt: "2026-02-15" }),
    ]);

    expect(result.get("DLO")).toBe("2026-04-02");
    expect(result.get("VOO")).toBe("2026-02-15");
  });
});

describe("buildAllocationRows", () => {
  it("joins position, metadata and reviews into a scored row", () => {
    const [row] = buildAllocationRows({
      positions: [position()],
      assets: [asset()],
      reviews: [
        { ticker: "DLO", period: "2026Q1", grade: "8", notes: "Take rate up" },
        { ticker: "DLO", period: "2025Q4", grade: "8", notes: null },
      ],
      lastContributionByTicker: new Map([["DLO", "2026-01-10"]]),
      displayCurrency: "BRL",
      today: TODAY,
    });

    expect(row).toMatchObject({
      ticker: "DLO",
      tracked: true,
      hasPosition: true,
      currentWeight: "0.01460000",
      targetWeight: "0.015",
      gapWeight: "0.00040000",
      averageGrade: "8.00",
      gradedQuarters: 2,
      lastContributionAt: "2026-01-10",
      valuationRef: "1Q26",
      marketValue: "3000.00",
    });
    // 1.5% target * 1.2355 = 1.85325%, minus the 1.46% held, times 1.0.
    expect(row?.score.value).toBe("0.00393250");
    expect(row?.score.ruleId).toBe("gap-weighted");
    // Reviews travel oldest first so the quarter grid can render in place.
    expect(row?.reviews.map((review) => review.period)).toEqual([
      "2025Q4",
      "2026Q1",
    ]);
  });

  it("lists watch-only assets with no position", () => {
    const rows = buildAllocationRows({
      positions: [],
      assets: [asset({ ticker: "CAVA", targetWeight: null, discount: null })],
      reviews: [],
      lastContributionByTicker: new Map(),
      displayCurrency: "BRL",
      today: TODAY,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticker: "CAVA",
      hasPosition: false,
      quantity: "0",
      marketValue: null,
      currentWeight: "0.00000000",
    });
    expect(rows[0]?.score.ruleId).toBe("no-target");
  });

  it("drops closed positions but keeps the ones still tracked", () => {
    const rows = buildAllocationRows({
      positions: [
        position({ ticker: "OSCR", quantity: "0", weight: null }),
        position({ ticker: "MU", quantity: "0", weight: null }),
      ],
      assets: [asset({ ticker: "MU" })],
      reviews: [],
      lastContributionByTicker: new Map(),
      displayCurrency: "BRL",
      today: TODAY,
    });

    expect(rows.map((row) => row.ticker)).toEqual(["MU"]);
    expect(rows[0]?.hasPosition).toBe(false);
  });

  it("treats an unquoted position as weightless and flags the gap", () => {
    const [row] = buildAllocationRows({
      positions: [
        position({
          marketPrice: null,
          convertedMarketValue: null,
          weight: null,
          quoteMissing: true,
        }),
      ],
      assets: [asset()],
      reviews: [],
      lastContributionByTicker: new Map(),
      displayCurrency: "BRL",
      today: TODAY,
    });

    expect(row?.currentWeight).toBe("0.00000000");
    expect(row?.quoteMissing).toBe(true);
  });

  it("sorts by the manual order and trails untracked tickers", () => {
    const rows = buildAllocationRows({
      positions: [
        position({ ticker: "AMZN" }),
        position({ ticker: "NFLX" }),
        position({ ticker: "VOO" }),
      ],
      assets: [
        asset({ ticker: "VOO", sortOrder: 2 }),
        asset({ ticker: "NFLX", sortOrder: 1 }),
      ],
      reviews: [],
      lastContributionByTicker: new Map(),
      displayCurrency: "BRL",
      today: TODAY,
    });

    expect(rows.map((row) => row.ticker)).toEqual(["NFLX", "VOO", "AMZN"]);
  });
});

describe("summarizeAllocation", () => {
  it("counts candidates, blocks and trims", () => {
    const rows = buildAllocationRows({
      positions: [
        position({ ticker: "DLO", weight: "0.0146" }),
        // Overweight and expensive: a trim candidate.
        position({ ticker: "AUGO", weight: "0.0494" }),
        // Bought last week: blocked by the cooldown.
        position({ ticker: "VOO", weight: "0.0372" }),
      ],
      assets: [
        asset({ ticker: "DLO" }),
        asset({ ticker: "AUGO", targetWeight: "0.035", discount: "-0.6449" }),
        asset({ ticker: "VOO", targetWeight: "0.04", discount: "0.1" }),
        asset({ ticker: "CAVA", targetWeight: null, discount: null }),
      ],
      reviews: [],
      lastContributionByTicker: new Map([["VOO", "2026-09-01"]]),
      displayCurrency: "BRL",
      today: TODAY,
    });
    const summary = summarizeAllocation(rows, "BRL");

    expect(summary).toMatchObject({
      displayCurrency: "BRL",
      investedAssets: 3,
      watchOnlyAssets: 1,
      candidates: 1,
      trimCandidates: 1,
      blocked: 1,
      totalTargetWeight: "0.09000000",
    });
    expect(summary.totalMarketValue).toBe("9000.00");
  });
});
