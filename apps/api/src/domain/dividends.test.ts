import type { AssetClass } from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import type { DividendEvent } from "../lib/dividends";
import {
  attachDividendEntitlements,
  type ConvertedDividendEvent,
  summarizeIncome,
} from "./dividends";
import type { ConsolidationInput } from "./positions";

const createdAt = new Date("2025-01-01T12:00:00Z");

describe("attachDividendEntitlements", () => {
  it("uses the position before the ex-date and excludes ex-date trades", () => {
    const events: DividendEvent[] = [
      {
        id: "event",
        ticker: "AAPL",
        currency: "USD",
        amountPerShare: "0.25",
        declarationDate: null,
        exDate: "2025-06-10",
        recordDate: null,
        paymentDate: "2025-06-15",
        source: "alpha_vantage",
      },
    ];
    const result = attachDividendEntitlements(
      events,
      [
        {
          ticker: "AAPL",
          assetClass: "stock_us",
          currency: "USD",
          side: "buy",
          quantity: "10",
          price: "100",
          fees: "0",
          tradedAt: "2025-05-01",
          createdAt,
        },
        {
          ticker: "AAPL",
          assetClass: "stock_us",
          currency: "USD",
          side: "buy",
          quantity: "5",
          price: "110",
          fees: "0",
          tradedAt: "2025-06-10",
          createdAt,
        },
      ],
      "2025-06-12",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.eligibleQuantity).toBe("10.00000000");
    expect(result[0]?.grossAmount).toBe("2.50");
    expect(result[0]?.status).toBe("scheduled");
  });
});

describe("summarizeIncome", () => {
  const today = "2026-10-04";
  const buy = (
    ticker: string,
    currency: "BRL" | "USD",
    quantity: string,
    price: string,
    assetClass: "stock_br" | "stock_us" | "reit" = "stock_br",
  ): ConsolidationInput => ({
    ticker,
    assetClass,
    currency,
    side: "buy",
    quantity,
    price,
    fees: "0",
    tradedAt: "2024-01-02",
    createdAt,
  });
  const event = (
    ticker: string,
    currency: "BRL" | "USD",
    day: string,
    gross: string,
    converted: string | null = gross,
    paymentDate: string | null = null,
  ): ConvertedDividendEvent => ({
    id: `${ticker}-${day}`,
    ticker,
    currency,
    amountPerShare: "1",
    declarationDate: null,
    exDate: day,
    recordDate: null,
    paymentDate,
    source: "yahoo",
    eligibleQuantity: "1",
    grossAmount: gross,
    status: day <= today ? "estimated_paid" : "announced",
    convertedGrossAmount: converted,
  });
  const assetClasses = new Map<string, AssetClass>([
    ["ITSA4|BRL", "stock_br"],
    ["HGLG11|BRL", "reit"],
    ["AAPL|USD", "stock_us"],
  ]);

  it("splits the last 12 months from the 12 before and averages them", () => {
    const result = summarizeIncome({
      events: [
        event("ITSA4", "BRL", "2026-09-01", "60.00"),
        event("ITSA4", "BRL", "2026-01-15", "60.00"),
        event("ITSA4", "BRL", "2025-06-01", "30.00"),
        // Announced: in the window and the chart, never in received income.
        event("ITSA4", "BRL", "2026-11-01", "99.00"),
      ],
      assetClasses,
      transactions: [buy("ITSA4", "BRL", "100", "10")],
      today,
      windowYears: 3,
      displayCurrency: "BRL",
      usdBrlRate: null,
    });

    expect(result).toMatchObject({
      trailing12m: "120.00",
      previous12m: "30.00",
      // 120 against 30 the year before.
      trailing12mChange: "3.000000",
      monthlyAverage: "10.00",
      // 120 over a 1,000 cost basis.
      yieldOnCost: "0.120000",
    });
    expect(result.byAsset[0]).toMatchObject({
      ticker: "ITSA4",
      windowTotal: "249.00",
      events: 4,
      held: true,
    });
    expect(result.byYear).toEqual([
      { year: 2025, amount: "30.00" },
      { year: 2026, amount: "219.00" },
    ]);
  });

  it("counts income on the payment day when it is published", () => {
    const result = summarizeIncome({
      // Ex-date inside the year, payment still ahead.
      events: [
        event("ITSA4", "BRL", "2026-09-28", "50.00", "50.00", "2026-10-20"),
      ],
      assetClasses,
      transactions: [buy("ITSA4", "BRL", "100", "10")],
      today,
      windowYears: 3,
      displayCurrency: "BRL",
      usdBrlRate: null,
    });

    expect(result.trailing12m).toBe("0.00");
    expect(result.monthly.map((month) => month.month)).toEqual(["2026-10"]);
  });

  it("keeps yield on cost in native currency per asset", () => {
    const result = summarizeIncome({
      events: [event("AAPL", "USD", "2026-08-01", "10.00", "50.00")],
      assetClasses,
      transactions: [buy("AAPL", "USD", "1", "200", "stock_us")],
      today,
      windowYears: 1,
      displayCurrency: "BRL",
      usdBrlRate: "5",
    });

    expect(result.previous12m).toBeNull();
    // Native: 10 USD over a 200 USD cost.
    expect(result.byAsset[0]?.yieldOnCost).toBe("0.050000");
    // Portfolio: 50 BRL over 200 USD × 5.
    expect(result.yieldOnCost).toBe("0.050000");
    expect(result.monthly[0]?.byAssetClass).toEqual([
      { assetClass: "stock_us", amount: "50.00" },
    ]);
  });

  it("dilutes the portfolio yield with holdings that paid nothing", () => {
    const result = summarizeIncome({
      events: [event("ITSA4", "BRL", "2026-05-01", "50.00")],
      assetClasses,
      transactions: [
        buy("ITSA4", "BRL", "100", "5"),
        buy("HGLG11", "BRL", "10", "50", "reit"),
      ],
      today,
      windowYears: 3,
      displayCurrency: "BRL",
      usdBrlRate: null,
    });

    // 50 over 500 + 500.
    expect(result.yieldOnCost).toBe("0.050000");
    expect(result.byAsset[0]?.yieldOnCost).toBe("0.100000");
  });

  it("has no yield on cost for an asset no longer held", () => {
    const result = summarizeIncome({
      events: [event("HGLG11", "BRL", "2026-05-01", "8.00")],
      assetClasses,
      transactions: [],
      today,
      windowYears: 3,
      displayCurrency: "BRL",
      usdBrlRate: null,
    });

    expect(result.byAsset[0]).toMatchObject({
      held: false,
      yieldOnCost: null,
    });
    expect(result.yieldOnCost).toBeNull();
  });
});
