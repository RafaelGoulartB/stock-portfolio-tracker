import { describe, expect, it } from "vitest";
import { toDecimal } from "../lib/decimal";
import {
  addMonths,
  contributionHistory,
  goalTargetValue,
  monthlyRate,
  monthsBetween,
  projectGoal,
} from "./goals";
import type { ConsolidationInput } from "./positions";

let sequence = 0;

function tx(
  partial: Partial<ConsolidationInput> & Pick<ConsolidationInput, "side">,
): ConsolidationInput {
  sequence += 1;

  return {
    ticker: "ACME",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "10",
    price: "100",
    fees: "0",
    tradedAt: "2026-01-15",
    createdAt: new Date(Date.UTC(2026, 0, 15, 0, 0, sequence)),
    ...partial,
  };
}

describe("month arithmetic", () => {
  it("shifts and measures across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2026-10", "2028-01")).toBe(15);
    expect(monthsBetween("2026-10", "2026-08")).toBe(-2);
  });
});

describe("contributionHistory", () => {
  const today = "2026-04-10";

  it("nets buys with fees against sale proceeds, month by month", () => {
    const history = contributionHistory({
      transactions: [
        tx({ side: "buy", tradedAt: "2026-01-05", fees: "5" }),
        tx({ side: "buy", tradedAt: "2026-01-20", quantity: "5" }),
        tx({
          side: "sell",
          tradedAt: "2026-03-02",
          quantity: "2",
          price: "150",
          fees: "1",
        }),
        tx({ side: "buy", tradedAt: "2026-04-01", quantity: "1" }),
      ],
      displayCurrency: "BRL",
      usdBrlRate: null,
      today,
    });

    expect(history.months).toEqual([
      { key: "2026-01", amount: "1505.00" },
      // A month without trades is still a month without contributions.
      { key: "2026-02", amount: "0.00" },
      { key: "2026-03", amount: "-299.00" },
      { key: "2026-04", amount: "100.00" },
    ]);
    expect(history.currentMonth).toBe("100.00");
    // The running month is not complete, so it stays out of the average.
    expect(history.recent).toEqual({
      months: 3,
      total: "1206.00",
      monthlyAverage: "402.00",
      monthsWithContribution: 1,
    });
    expect(history.years).toEqual([{ year: 2026, amount: "1306.00" }]);
  });

  it("averages only the last twelve complete months", () => {
    const transactions = Array.from({ length: 14 }, (_, index) =>
      tx({
        side: "buy",
        tradedAt: `${addMonths("2025-02", index)}-10`,
        quantity: String(index + 1),
      }),
    );
    const history = contributionHistory({
      transactions,
      displayCurrency: "BRL",
      usdBrlRate: null,
      today,
    });

    // 2025-04 … 2026-03 hold quantities 3 … 14 at 100 each.
    expect(history.recent.months).toBe(12);
    expect(history.recent.total).toBe("10200.00");
    expect(history.recent.monthlyAverage).toBe("850.00");
    expect(history.years).toEqual([
      { year: 2025, amount: "6600.00" },
      { year: 2026, amount: "3900.00" },
    ]);
  });

  it("converts foreign trades at their own rate, else today's", () => {
    const history = contributionHistory({
      transactions: [
        tx({
          side: "buy",
          ticker: "AAPL",
          currency: "USD",
          assetClass: "stock_us",
          quantity: "1",
          price: "100",
          usdBrlRate: "5",
          tradedAt: "2026-03-10",
        }),
        tx({
          side: "buy",
          ticker: "AAPL",
          currency: "USD",
          assetClass: "stock_us",
          quantity: "1",
          price: "100",
          tradedAt: "2026-03-11",
        }),
      ],
      displayCurrency: "BRL",
      usdBrlRate: "6",
      today,
    });

    expect(history.months.at(0)).toEqual({ key: "2026-03", amount: "1100.00" });
    expect(history.approximatedTrades).toBe(1);
    expect(history.unconvertedTrades).toBe(0);
  });

  it("leaves out a foreign trade no rate can convert, and says so", () => {
    const history = contributionHistory({
      transactions: [
        tx({ side: "buy", tradedAt: "2026-03-10" }),
        tx({
          side: "buy",
          currency: "USD",
          assetClass: "stock_us",
          tradedAt: "2026-03-11",
        }),
      ],
      displayCurrency: "BRL",
      usdBrlRate: null,
      today,
    });

    expect(history.months.at(0)?.amount).toBe("1000.00");
    expect(history.unconvertedTrades).toBe(1);
  });

  it("has no months and no average for an empty ledger", () => {
    const history = contributionHistory({
      transactions: [],
      displayCurrency: "USD",
      usdBrlRate: null,
      today,
    });

    expect(history.months).toEqual([]);
    expect(history.recent.monthlyAverage).toBeNull();
    expect(history.currentMonth).toBe("0.00");
  });
});

describe("goalTargetValue", () => {
  it("turns a monthly income into the value that pays it", () => {
    expect(goalTargetValue("income", "10000", "0.04")).toBe("3000000.00");
  });

  it("keeps a value goal as stated", () => {
    expect(goalTargetValue("value", "500000", "0.04")).toBe("500000.00");
  });
});

describe("monthlyRate", () => {
  it("is the twelfth root of the yearly growth", () => {
    expect(monthlyRate("0.04")).toBe(toDecimal("0.00327374"));
    expect(monthlyRate("0")).toBe(0n);
  });
});

describe("projectGoal", () => {
  const scenarios = [
    { scenario: "conservative" as const, annualReturn: "0" },
    { scenario: "base" as const, annualReturn: "0.04" },
    { scenario: "optimistic" as const, annualReturn: "0.06" },
  ];

  it("accumulates contributions month by month", () => {
    const projection = projectGoal({
      currentValue: "0",
      monthlyContribution: "1000",
      targetValue: "12000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: "2028-10",
      currentMonth: "2026-10",
    });
    const flat = projection.scenarios[0];

    expect(flat.monthsToTarget).toBe(12);
    expect(flat.reachMonth).toBe("2027-10");
    expect(flat.valueAtTargetMonth).toBe("24000.00");
    expect(flat.requiredMonthlyContribution).toBe("500.00");
    expect(flat.onTrack).toBe(true);
    expect(flat.points.slice(0, 3)).toEqual([
      { month: "2026-10", value: "0.00" },
      { month: "2027-10", value: "12000.00" },
      { month: "2028-10", value: "24000.00" },
    ]);
    // Growth only helps: higher returns reach the goal no later.
    expect(projection.scenarios[1].monthsToTarget).toBeLessThanOrEqual(12);
    expect(projection.progress).toBe("0.000000");
  });

  it("derives today's sustainable income and the progress", () => {
    const projection = projectGoal({
      currentValue: "1500000",
      monthlyContribution: "0",
      targetValue: "3000000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: null,
      currentMonth: "2026-10",
    });

    expect(projection.targetMonthlyIncome).toBe("10000.00");
    expect(projection.sustainableMonthlyIncome).toBe("5000.00");
    expect(projection.progress).toBe("0.500000");
    expect(projection.monthsToTargetMonth).toBeNull();
    expect(projection.scenarios[0].monthsToTarget).toBeNull();
    // 4% a year doubles the value in a little under 18 years.
    expect(projection.scenarios[1].monthsToTarget).toBe(213);
    expect(projection.scenarios[1].onTrack).toBeNull();
    expect(projection.scenarios[1].requiredMonthlyContribution).toBeNull();
  });

  it("asks for a contribution that lands exactly on the target month", () => {
    const first = projectGoal({
      currentValue: "100000",
      monthlyContribution: "0",
      targetValue: "1000000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: "2046-10",
      currentMonth: "2026-10",
    });
    const required = first.scenarios[1].requiredMonthlyContribution;

    expect(required).not.toBeNull();
    expect(first.scenarios[1].onTrack).toBe(false);

    const funded = projectGoal({
      currentValue: "100000",
      monthlyContribution: required as string,
      targetValue: "1000000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: "2046-10",
      currentMonth: "2026-10",
    });
    const value = Number(funded.scenarios[1].valueAtTargetMonth);

    // Rounded to cents per month, so it lands within a few reais.
    expect(Math.abs(value - 1_000_000)).toBeLessThan(5);
  });

  it("needs nothing more once growth alone reaches the goal", () => {
    const projection = projectGoal({
      currentValue: "900000",
      monthlyContribution: "0",
      targetValue: "1000000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: "2036-10",
      currentMonth: "2026-10",
    });

    expect(projection.scenarios[2].requiredMonthlyContribution).toBe("0.00");
    expect(projection.scenarios[2].onTrack).toBe(true);
  });

  it("reports a goal already reached at month zero", () => {
    const projection = projectGoal({
      currentValue: "200000",
      monthlyContribution: "1000",
      targetValue: "100000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: null,
      currentMonth: "2026-10",
    });

    expect(projection.scenarios.map((entry) => entry.monthsToTarget)).toEqual([
      0, 0, 0,
    ]);
    expect(projection.progress).toBe("2.000000");
    expect(projection.horizonMonths).toBe(132);
  });

  it("keeps an unreachable goal unreached with a bounded horizon", () => {
    const projection = projectGoal({
      currentValue: "1",
      monthlyContribution: "0",
      targetValue: "1000000",
      withdrawalRate: "0.04",
      scenarios: [{ scenario: "base", annualReturn: "0" }],
      targetMonth: null,
      currentMonth: "2026-10",
    });

    expect(projection.scenarios[0].reachMonth).toBeNull();
    expect(projection.horizonMonths).toBe(372);
    expect(projection.scenarios[0].points).toHaveLength(32);
  });

  it("leaves a target month in the past without a required contribution", () => {
    const projection = projectGoal({
      currentValue: "1000",
      monthlyContribution: "100",
      targetValue: "100000",
      withdrawalRate: "0.04",
      scenarios,
      targetMonth: "2026-01",
      currentMonth: "2026-10",
    });

    expect(projection.monthsToTargetMonth).toBe(-9);
    expect(projection.scenarios[1].requiredMonthlyContribution).toBeNull();
    expect(projection.scenarios[1].onTrack).toBe(false);
  });
});
