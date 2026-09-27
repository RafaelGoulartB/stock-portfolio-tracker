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

/** A held candidate at full priority; weights are shares of the book. */
function row(
  ticker: string,
  tiltedTarget: string,
  currentWeight: string,
  overrides: Partial<ContributionPlanRow> = {},
): ContributionPlanRow {
  return {
    ticker,
    currency: "BRL",
    score: "1",
    priority: "1",
    tiltedTarget,
    currentWeight,
    maxWeight: null,
    held: true,
    executionPrice: "10.00",
    executionFxApplied: false,
    wholeUnits: false,
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
        rows: [row("WEGE3", "0.06", "0.04")],
        amount: "0",
        portfolioValue: MILLION,
      }).slices,
    ).toEqual([]);
    expect(
      planContribution({
        rows: [row("WEGE3", "0.06", "0.04", { score: "0" })],
        amount: "1000",
        portfolioValue: MILLION,
      }).slices,
    ).toEqual([]);
  });

  it("sizes the need against the book after the contribution", () => {
    // 50% of R$150,000 minus R$40,000 held; v1 stopped at R$15,000.
    const result = planContribution({
      rows: [row("WEGE3", "0.5", "0.4")],
      amount: "50000",
      portfolioValue: "100000",
    });

    expect(result.slices[0]).toMatchObject({
      amount: "35000.00",
      cappedByNeed: true,
    });
    expect(result.remainder).toBe("15000.00");
  });

  it("funds the emptier target before the fuller one", () => {
    // Same 2 p.p. gap: 10% → 8% is 80% full, 2% → 0.2% is 10% full.
    const result = planContribution({
      rows: [row("WEGE3", "0.10", "0.08"), row("TOTS3", "0.02", "0.002")],
      amount: "10000",
      portfolioValue: MILLION,
      spread: 0,
    });

    expect(result.slices.map((slice) => [slice.ticker, slice.amount])).toEqual([
      ["TOTS3", "7000.00"],
      ["WEGE3", "3000.00"],
    ]);
    expect(result.slices[0]?.cappedByShare).toBe(true);
  });

  it("fills a higher priority closer to its target", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.05", "0.03"),
        row("ITUB4", "0.05", "0.03", { priority: "0.5" }),
      ],
      amount: "20000",
      portfolioValue: MILLION,
      config: { ...config, maxShare: "1" },
      spread: 0,
    });

    expect(result.slices.map((slice) => [slice.ticker, slice.amount])).toEqual([
      ["WEGE3", "13666.67"],
      ["ITUB4", "6333.33"],
    ]);
  });

  it("stops at the post-contribution weight ceiling", () => {
    const result = planContribution({
      rows: [row("WEGE3", "0.07", "0.05", { maxWeight: "0.065" })],
      amount: "100000",
      portfolioValue: MILLION,
    });

    expect(result.slices[0]).toMatchObject({
      amount: "21500.00",
      cappedByLimit: true,
      cappedByNeed: false,
    });
    expect(result.remainder).toBe("78500.00");
  });

  it("builds a new position over several cheques", () => {
    const result = planContribution({
      rows: [row("WEGE3", "0.05", "0", { held: false })],
      amount: "100000",
      portfolioValue: MILLION,
    });

    // Half of 5% of R$1.1M.
    expect(result.slices[0]).toMatchObject({
      amount: "27500.00",
      cappedByLimit: true,
    });
  });

  it("does not limit the first cheque of an empty book", () => {
    const result = planContribution({
      rows: [row("WEGE3", "0.5", "0", { held: false })],
      amount: "10000",
      portfolioValue: "0",
    });

    expect(result.slices[0]).toMatchObject({
      amount: "5000.00",
      cappedByNeed: true,
      cappedByLimit: false,
    });
  });

  it("sends a R$1,000 cheque on a R$1M book to a single name", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.06", "0.04"),
        row("ITUB4", "0.05", "0.04"),
        row("B3SA3", "0.045", "0.04"),
      ],
      amount: "1000",
      portfolioValue: MILLION,
    });

    expect(result.spreadMode).toBe("auto");
    expect(result.targetCount).toBe(1);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]).toMatchObject({
      ticker: "WEGE3",
      amount: "1000.00",
    });
    expect(result.remainder).toBe("0.00");
  });

  it("does not seat names whose room is below a meaningful slice", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.10", "0.05"),
        row("ITUB4", "0.0501", "0.05"),
        row("B3SA3", "0.0501", "0.05"),
      ],
      amount: "15000",
      portfolioValue: MILLION,
    });

    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]).toMatchObject({
      ticker: "WEGE3",
      amount: "15000.00",
    });
  });

  it("drops crumb slices but keeps two seats under the share cap", () => {
    const result = planContribution({
      rows: [
        row("WEGE3", "0.10", "0.05"),
        row("ITUB4", "0.03", "0.02"),
        row("B3SA3", "0.029", "0.02"),
      ],
      amount: "15000",
      portfolioValue: MILLION,
    });

    expect(result.slices.map((slice) => [slice.ticker, slice.amount])).toEqual([
      ["WEGE3", "10500.00"],
      ["ITUB4", "4500.00"],
    ]);
    expect(result.slices[0]?.cappedByShare).toBe(true);
  });

  it("seats the next names when every seat is full", () => {
    const result = planContribution({
      rows: ["AAAA3", "BBBB3", "CCCC3", "DDDD3"].map((ticker) =>
        row(ticker, "0.044", "0.04"),
      ),
      amount: "15000",
      portfolioValue: MILLION,
    });

    expect(result.slices.map((slice) => slice.amount)).toEqual([
      "3750.00",
      "3750.00",
      "3750.00",
      "3750.00",
    ]);
    expect(result.allocated).toBe("15000.00");
  });

  it("sizes units from the execution price and keeps FX flags", () => {
    const result = planContribution({
      rows: [
        row("AAPL", "0.06", "0.04", {
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

  it("floors whole-unit slices and reports the money a share cannot use", () => {
    const result = planContribution({
      rows: [
        row("BBSE3", "0.06", "0.04", {
          executionPrice: "40.00",
          wholeUnits: true,
        }),
      ],
      amount: "1000",
      portfolioValue: MILLION,
    });

    expect(result.slices[0]).toMatchObject({
      amount: "1000.00",
      units: "25.0000",
    });

    const uneven = planContribution({
      rows: [
        row("BBSE3", "0.06", "0.04", {
          executionPrice: "30.00",
          wholeUnits: true,
        }),
      ],
      amount: "1000",
      portfolioValue: MILLION,
    });

    expect(uneven.slices[0]).toMatchObject({
      amount: "990.00",
      units: "33.0000",
    });
    expect(uneven.remainder).toBe("10.00");
    expect(uneven.unitRoundingRemainder).toBe("10.00");
  });

  it("spends whole-unit leftovers on another share where the cap has room", () => {
    const result = planContribution({
      rows: [
        row("TOTS3", "0.06", "0.04", {
          executionPrice: "30.00",
          wholeUnits: true,
        }),
        row("AAPL", "0.06", "0.04", {
          currency: "USD",
          executionPrice: "1000.00",
        }),
      ],
      amount: "1000",
      portfolioValue: MILLION,
      spread: 2,
    });
    const tots = result.slices.find((slice) => slice.ticker === "TOTS3");
    const apple = result.slices.find((slice) => slice.ticker === "AAPL");

    // 500 buys 16 shares (480); the freed 20 cannot buy a 17th.
    expect(tots).toMatchObject({ amount: "480.00", units: "16.0000" });
    expect(apple).toMatchObject({ amount: "500.00", units: "0.5000" });
    expect(result.unitRoundingRemainder).toBe("20.00");
    expect(result.remainder).toBe("20.00");
  });

  it("drops a whole-unit slice that cannot afford one share", () => {
    const result = planContribution({
      rows: [
        row("TOTS3", "0.06", "0.04", {
          executionPrice: "300.00",
          wholeUnits: true,
        }),
      ],
      amount: "100",
      portfolioValue: MILLION,
    });

    expect(result.slices).toHaveLength(0);
    expect(result.remainder).toBe("100.00");
    expect(result.unitRoundingRemainder).toBe("100.00");
  });

  it("reads custom knobs instead of hard-wired thresholds", () => {
    const custom: ContributionPlanConfig = {
      ...DEFAULT_CONTRIBUTION_PLAN_CONFIG,
      smallBookImpact: "0.01",
      largeBookImpact: "0.01",
      maxShare: "0.60",
      maxAssets: 2,
    };
    const rows = [
      row("WEGE3", "0.10", "0.05"),
      row("ITUB4", "0.03", "0.02"),
      row("B3SA3", "0.03", "0.02"),
    ];
    const small = planContribution({
      rows,
      amount: "5000",
      portfolioValue: MILLION,
      config: custom,
    });
    const large = planContribution({
      rows,
      amount: "40000",
      portfolioValue: MILLION,
      config: custom,
    });

    expect(small.selectedCount).toBe(1);
    expect(large.targetCount).toBe(2);
    expect(large.slices[0]).toMatchObject({
      amount: "24000.00",
      cappedByShare: true,
    });
    // 3% of R$1.04M minus R$20,000 held; maxAssets keeps the rest unspent.
    expect(large.slices[1]).toMatchObject({
      amount: "11200.00",
      cappedByNeed: true,
    });
    expect(large.remainder).toBe("4800.00");
  });
});

describe("planContribution invariants", () => {
  /** Deterministic LCG so every run explores the same books. */
  function random(seed: number) {
    let state = seed;

    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
  }

  it("conserves money and never exceeds a need or a ceiling", () => {
    const next = random(42);
    const fixed = (value: number, places = 4) => value.toFixed(places);

    for (let book = 0; book < 300; book += 1) {
      const portfolioValue = next() < 0.1 ? "0" : fixed(next() * 2_000_000, 2);
      const amount = fixed(100 + next() * 100_000, 2);
      const spreadRoll = Math.floor(next() * 7);
      const spread = spreadRoll === 6 ? null : spreadRoll;
      const rows = Array.from({ length: 1 + Math.floor(next() * 8) }, (_, i) =>
        row(`T${i}`, fixed(next() * 0.2), fixed(next() * 0.2), {
          score: next() < 0.8 ? "1" : "0",
          priority: fixed(0.1 + next() * 0.9),
          maxWeight: next() < 0.5 ? fixed(next() * 0.3) : null,
          held: next() < 0.8,
        }),
      );
      const result = planContribution({
        rows,
        amount,
        portfolioValue,
        spread,
      });
      const postValue = Number(portfolioValue) + Number(amount);

      expect(
        formatDecimal(
          toDecimal(result.allocated) + toDecimal(result.remainder),
          2,
        ),
      ).toBe(amount);

      for (const slice of result.slices) {
        const source = rows.find(
          (candidate) => candidate.ticker === slice.ticker,
        );
        const held = Number(source?.currentWeight) * Number(portfolioValue);
        const need = Number(source?.tiltedTarget) * postValue - held;

        expect(Number(slice.amount)).toBeGreaterThan(0);
        expect(source?.score).toBe("1");
        expect(Number(slice.amount)).toBeLessThanOrEqual(need + 0.01);

        if (source?.maxWeight != null) {
          expect(Number(slice.amount)).toBeLessThanOrEqual(
            Number(source.maxWeight) * postValue - held + 0.01,
          );
        }
      }
    }
  });
});
