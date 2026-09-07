import {
  type ContributionPlanConfig,
  DEFAULT_CONTRIBUTION_PLAN_CONFIG,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import { formatDecimal, toDecimal } from "../lib/decimal";
import {
  type ContributionPlanRow,
  planContribution,
  targetContributionCount,
  weightImpactForPortfolio,
} from "./contribution-plan";

function row(
  ticker: string,
  score: string,
  overrides: Partial<ContributionPlanRow> = {},
): ContributionPlanRow {
  return {
    ticker,
    currency: "BRL",
    score,
    executionPrice: "10.00",
    executionFxApplied: false,
    ...overrides,
  };
}

const MILLION = "1000000.00";
const config = DEFAULT_CONTRIBUTION_PLAN_CONFIG;

describe("weightImpactForPortfolio", () => {
  it("uses the small-book impact at or below R$100,000", () => {
    expect(weightImpactForPortfolio(toDecimal("50000"))).toBe(
      toDecimal("0.02"),
    );
    expect(weightImpactForPortfolio(toDecimal("100000"))).toBe(
      toDecimal("0.02"),
    );
  });

  it("uses the large-book impact at or above R$1,000,000", () => {
    expect(weightImpactForPortfolio(toDecimal(MILLION))).toBe(
      toDecimal("0.005"),
    );
    expect(weightImpactForPortfolio(toDecimal("5000000"))).toBe(
      toDecimal("0.005"),
    );
  });

  it("interpolates in log space between the two book sizes", () => {
    const impact = Number(
      formatDecimal(weightImpactForPortfolio(toDecimal("200000")), 8),
    );

    expect(impact).toBeGreaterThan(0.005);
    expect(impact).toBeLessThan(0.02);
    expect(impact).toBeCloseTo(0.01548455, 5);
  });
});

describe("targetContributionCount", () => {
  it("concentrates a tiny cheque into one name on a large book", () => {
    const result = targetContributionCount(
      toDecimal("1000"),
      toDecimal(MILLION),
      8,
      config,
      null,
    );

    expect(result.mode).toBe("auto");
    expect(result.count).toBe(1);
    expect(result.relativeSize).toBe(toDecimal("0.001"));
  });

  it("opens a second name at 1.5× a minimum slice, not 2×", () => {
    const result = targetContributionCount(
      toDecimal("7500"),
      toDecimal(MILLION),
      8,
      config,
      null,
    );

    expect(result.count).toBe(2);
  });

  it("splits R$2,000 across two names on a R$50,000 book", () => {
    const result = targetContributionCount(
      toDecimal("2000"),
      toDecimal("50000"),
      8,
      config,
      null,
    );

    expect(result.count).toBe(2);
  });

  it("keeps a R$500 cheque as a single name on a small book", () => {
    const result = targetContributionCount(
      toDecimal("500"),
      toDecimal("50000"),
      8,
      config,
      null,
    );

    expect(result.count).toBe(1);
  });

  it("keeps a R$2,000 monthly cheque as one name on a R$1M book", () => {
    expect(
      targetContributionCount(
        toDecimal("2000"),
        toDecimal(MILLION),
        8,
        config,
        null,
      ).count,
    ).toBe(1);
  });

  it("caps diversification at maxAssets", () => {
    const result = targetContributionCount(
      toDecimal("50000"),
      toDecimal(MILLION),
      12,
      config,
      null,
    );

    expect(result.count).toBe(5);
  });

  it("diversifies an empty book up to maxAssets", () => {
    const result = targetContributionCount(
      toDecimal("10000"),
      toDecimal("0"),
      8,
      config,
      null,
    );

    expect(result.count).toBe(5);
    expect(result.relativeSize).toBeNull();
  });

  it("honours a manual spread and the all-candidates override", () => {
    expect(
      targetContributionCount(
        toDecimal("1000"),
        toDecimal(MILLION),
        8,
        config,
        3,
      ).count,
    ).toBe(3);
    expect(
      targetContributionCount(
        toDecimal("1000"),
        toDecimal(MILLION),
        8,
        config,
        0,
      ).count,
    ).toBe(8);
  });
});

describe("planContribution", () => {
  it("returns nothing without a positive amount or a candidate", () => {
    expect(
      planContribution({
        rows: [row("WEGE3", "0.02")],
        amount: "0",
        portfolioValue: MILLION,
      }).slices,
    ).toEqual([]);
    expect(
      planContribution({
        rows: [row("WEGE3", "0")],
        amount: "1000",
        portfolioValue: MILLION,
      }).slices,
    ).toEqual([]);
  });

  it("sends a R$1,000 cheque on a R$1M book to a single name", () => {
    const result = planContribution({
      rows: [row("WEGE3", "0.02"), row("ITUB4", "0.015"), row("B3SA3", "0.01")],
      amount: "1000",
      portfolioValue: MILLION,
    });

    expect(result.spreadMode).toBe("auto");
    expect(result.targetCount).toBe(1);
    expect(result.selectedCount).toBe(1);
    expect(result.slices[0]?.ticker).toBe("WEGE3");
    expect(result.slices[0]?.amount).toBe("1000.00");
    expect(result.allocated).toBe("1000.00");
    expect(result.remainder).toBe("0.00");
  });

  it("splits R$15,000 on a R$1M book across three names", () => {
    const result = planContribution({
      rows: [row("WEGE3", "0.02"), row("ITUB4", "0.015"), row("B3SA3", "0.01")],
      amount: "15000",
      portfolioValue: MILLION,
    });

    expect(result.targetCount).toBe(3);
    expect(result.slices.map((slice) => slice.ticker)).toEqual([
      "WEGE3",
      "ITUB4",
      "B3SA3",
    ]);
    expect(result.allocated).toBe("15000.00");
  });

  it("does not sprinkle crumbs onto names with a negligible scored need", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.05"),
        row("ITUB4", "0.0001"),
        row("B3SA3", "0.0001"),
      ],
      amount: "5000",
      portfolioValue: MILLION,
    });

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]?.ticker).toBe("WEGE3");
    expect(result.slices[0]?.amount).toBe("5000.00");
  });

  it("caps a dominant score at maxShare and redistributes the rest", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.05"),
        row("ITUB4", "0.008"),
        row("B3SA3", "0.007"),
      ],
      amount: "15000",
      portfolioValue: MILLION,
    });

    expect(result.slices).toHaveLength(3);
    expect(result.slices[0]?.ticker).toBe("WEGE3");
    expect(result.slices[0]?.amount).toBe("10500.00");
    expect(result.slices[0]?.cappedByShare).toBe(true);
    expect(result.slices[1]?.amount).toBe("2400.00");
    expect(result.slices[2]?.amount).toBe("2100.00");
    expect(result.allocated).toBe("15000.00");
  });

  it("waterfalls leftover need onto the next names instead of abandoning it", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.001"),
        row("ITUB4", "0.001"),
        row("B3SA3", "0.001"),
      ],
      amount: "50000",
      portfolioValue: MILLION,
    });

    expect(result.slices).toHaveLength(3);
    expect(result.slices.every((slice) => slice.amount === "1050.00")).toBe(
      true,
    );
    expect(result.allocated).toBe("3150.00");
    expect(result.remainder).toBe("46850.00");
  });

  it("fills every invited name up to its need when the override is all", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.001"),
        row("ITUB4", "0.001"),
        row("B3SA3", "0.001"),
      ],
      amount: "50000",
      portfolioValue: MILLION,
      spread: 0,
    });

    expect(result.spreadMode).toBe("all");
    expect(result.slices).toHaveLength(3);
    expect(result.allocated).toBe("3150.00");
  });

  it("spreads the first cheque on an empty book up to maxAssets", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.20"),
        row("ITUB4", "0.20"),
        row("B3SA3", "0.20"),
        row("PETR4", "0.20"),
        row("VALE3", "0.20"),
        row("BBAS3", "0.20"),
      ],
      amount: "10000",
      portfolioValue: "0",
    });

    expect(result.targetCount).toBe(5);
    expect(result.selectedCount).toBe(5);
    expect(result.relativeSize).toBeNull();
    expect(result.slices[0]?.amount).toBe("2000.00");
  });

  it("lets a manual spread ignore the automatic count but still cap need", () => {
    const result = planContribution({
      rows: [row("WEGE3", "0.02"), row("ITUB4", "0.015"), row("B3SA3", "0.01")],
      amount: "1000",
      portfolioValue: MILLION,
      spread: 3,
    });

    expect(result.spreadMode).toBe("manual");
    expect(result.targetCount).toBe(3);
    expect(result.slices).toHaveLength(3);
  });

  it("sizes units from the execution price and keeps FX flags", () => {
    const result = planContribution({
      rows: [
        row("AAPL", "0.02", {
          currency: "USD",
          executionPrice: "200.00",
          executionFxApplied: true,
        }),
      ],
      amount: "1000",
      portfolioValue: MILLION,
    });

    expect(result.slices[0]?.units).toBe("5.0000");
    expect(result.slices[0]?.executionFxApplied).toBe(true);
  });

  it("reads custom knobs instead of hard-wired thresholds", () => {
    const custom: ContributionPlanConfig = {
      ...DEFAULT_CONTRIBUTION_PLAN_CONFIG,
      smallBookImpact: "0.01",
      largeBookImpact: "0.01",
      maxShare: "0.60",
      maxAssets: 2,
    };
    const small = planContribution({
      rows: [row("WEGE3", "0.05"), row("ITUB4", "0.04"), row("B3SA3", "0.03")],
      amount: "5000",
      portfolioValue: MILLION,
      config: custom,
    });
    const large = planContribution({
      rows: [row("WEGE3", "0.08"), row("ITUB4", "0.02"), row("B3SA3", "0.02")],
      amount: "40000",
      portfolioValue: MILLION,
      config: custom,
    });

    expect(small.selectedCount).toBe(1);
    expect(large.targetCount).toBe(2);
    expect(large.slices[0]?.amount).toBe("24000.00");
    expect(large.slices[0]?.cappedByShare).toBe(true);
    expect(large.slices[1]?.amount).toBe("16000.00");
  });
});
