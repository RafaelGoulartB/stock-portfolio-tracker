import { describe, expect, it } from "vitest";
import type { ConsolidationInput } from "./positions";
import { exemptSalesInMonth, planSales, type SellPlanRow } from "./sell-plan";

function trade(overrides: Partial<ConsolidationInput>): ConsolidationInput {
  return {
    ticker: "ITUB3",
    assetClass: "stock_br",
    currency: "BRL",
    side: "sell",
    quantity: "100",
    price: "30",
    fees: "0",
    tradedAt: "2026-09-10",
    createdAt: new Date("2026-09-10T12:00:00Z"),
    ...overrides,
  };
}

function row(overrides: Partial<SellPlanRow>): SellPlanRow {
  return {
    ticker: "ITUB3",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "1000",
    marketValue: "60000",
    currentWeight: "0.06",
    tiltedTarget: "0.04",
    fairValue: "40",
    marketPrice: "60",
    wholeUnits: true,
    ...overrides,
  };
}

const BOOK = "1000000";

describe("exemptSalesInMonth", () => {
  it("adds gross Brazilian stock sales of the current month only", () => {
    const total = exemptSalesInMonth(
      [
        trade({}),
        trade({ tradedAt: "2026-08-31" }),
        trade({ side: "buy" }),
        trade({ assetClass: "reit", ticker: "HGLG11" }),
        trade({ assetClass: "stock_us", currency: "USD", ticker: "AAPL" }),
      ],
      "2026-09-27",
    );

    expect(total).toBe("3000.00");
  });
});

describe("planSales", () => {
  const base = {
    portfolioValue: BOOK,
    displayCurrency: "BRL" as const,
    usdBrlRate: null,
    soldThisMonthBrl: "0",
    confidence: "0.5",
  };

  it("brings an expensive overweight stock back to its tilted target", () => {
    const plan = planSales({
      ...base,
      rows: [
        row({ currentWeight: "0.051", marketValue: "51000", quantity: "850" }),
      ],
    });

    // 5.1% vs 4% × 1.25 = 5%: past the band; sell 1.1% of the book.
    expect(plan.exempt).toHaveLength(1);
    expect(plan.exempt[0]).toMatchObject({
      ticker: "ITUB3",
      excess: "11000.00",
      amount: "10980.00",
      units: "183.0000",
    });
    expect(plan.remaining).toBe("20000.00");
    expect(plan.scaled).toBe(false);
  });

  it("skips assets inside the band or not above their fair value", () => {
    const plan = planSales({
      ...base,
      rows: [
        row({ ticker: "WEGE3", currentWeight: "0.049", marketValue: "49000" }),
        row({ ticker: "BBAS3", fairValue: "70" }),
      ],
    });

    expect(plan.exempt).toEqual([]);
    expect(plan.taxable).toEqual([]);
  });

  it("fits exempt sales inside what is left of the monthly exemption", () => {
    const plan = planSales({
      ...base,
      soldThisMonthBrl: "5000",
      rows: [
        row({ ticker: "ITUB3" }),
        row({
          ticker: "BBDC4",
          marketPrice: "20",
          fairValue: "15",
          quantity: "3000",
        }),
      ],
    });

    expect(plan.remaining).toBe("15000.00");
    expect(plan.exemptExcess).toBe("40000.00");
    expect(plan.scaled).toBe(true);
    // Each has R$ 20.000 of excess; both are scaled to share R$ 15.000.
    expect(Number(plan.total)).toBeLessThanOrEqual(15000);
    expect(plan.exempt.map((item) => item.ticker).sort()).toEqual([
      "BBDC4",
      "ITUB3",
    ]);
  });

  it("lists taxable classes separately and never inside the exemption", () => {
    const plan = planSales({
      ...base,
      rows: [row({ ticker: "HGLG11", assetClass: "reit" })],
    });

    expect(plan.exempt).toEqual([]);
    expect(plan.taxable[0]).toMatchObject({
      ticker: "HGLG11",
      excess: "20000.00",
    });
    expect(plan.total).toBe("0.00");
  });

  it("recommends only once the track record earned it", () => {
    const early = planSales({ ...base, rows: [row({})] });
    const proven = planSales({ ...base, confidence: "0.9", rows: [row({})] });

    expect(early.recommended).toBe(false);
    expect(proven.recommended).toBe(true);
  });

  it("expresses the BRL exemption in USD when the book is shown in dollars", () => {
    const plan = planSales({
      ...base,
      displayCurrency: "USD",
      usdBrlRate: "5",
      rows: [],
    });

    expect(plan.exemptLimit).toBe("4000.00");
  });
});
