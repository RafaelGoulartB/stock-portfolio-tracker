import { DEFAULT_SCORE_CONFIG } from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  type ClosePoint,
  closeOnOrBefore,
  momentum12to1,
  referencePrice,
  type SkillObservation,
  shiftMonths,
  skillObservations,
  valuationSkill,
} from "./valuation-skill";

function monthly(start: string, closes: number[]): ClosePoint[] {
  return closes.map((close, index) => ({
    asOf: shiftMonths(start, -index),
    close: String(close),
  }));
}

describe("price helpers", () => {
  it("shifts months and clamps to the month's last day", () => {
    expect(shiftMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(shiftMonths("2026-09-27", 12)).toBe("2025-09-27");
    expect(shiftMonths("2026-06-30", -12)).toBe("2027-06-30");
  });

  it("reads the last close at or before a day", () => {
    const points = [
      { asOf: "2026-06-26", close: "10" },
      { asOf: "2026-06-29", close: "11" },
      { asOf: "2026-07-01", close: "12" },
    ];

    expect(closeOnOrBefore(points, "2026-06-30")).toBe(11);
    expect(closeOnOrBefore(points, "2026-06-01")).toBeNull();
  });

  it("measures 12-1 momentum and skips the latest month", () => {
    // 2025-09-27 → 100 … 2026-08-27 → 150; the last month's jump is ignored.
    const points = monthly(
      "2025-09-27",
      [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 148, 150, 300],
    );

    expect(Number(momentum12to1(points, "2026-09-27"))).toBeCloseTo(
      Math.log(1.5),
      7,
    );
    expect(momentum12to1(points.slice(3), "2026-09-27")).toBeNull();
  });

  it("uses the quarter-end close as the fair value's reference price", () => {
    const points = [
      { asOf: "2026-06-29", close: "20" },
      { asOf: "2026-06-30", close: "21" },
      { asOf: "2026-07-01", close: "25" },
    ];

    expect(referencePrice(points, "2026Q2")).toBe("21.00000000");
  });
});

describe("skillObservations", () => {
  const series = new Map([
    [
      "AAA",
      [
        { asOf: "2025-06-30", close: "10" },
        { asOf: "2026-06-30", close: "15" },
      ],
    ],
  ]);

  it("pairs a fair value with its 12-month outcome", () => {
    const { observations, pending } = skillObservations(
      [{ ticker: "AAA", period: "2025Q2", fairValue: "20" }],
      series,
      "2026-09-27",
    );

    expect(pending).toBe(0);
    expect(observations[0]?.discount).toBeCloseTo(Math.log(2), 10);
    expect(observations[0]?.outcome).toBeCloseTo(Math.log(1.5), 10);
  });

  it("counts reviews whose outcome is still in the future as pending", () => {
    const { observations, pending } = skillObservations(
      [{ ticker: "AAA", period: "2026Q2", fairValue: "20" }],
      series,
      "2026-09-27",
    );

    expect(observations).toEqual([]);
    expect(pending).toBe(1);
  });
});

function quarter(
  period: string,
  pairs: [number, number][],
): SkillObservation[] {
  return pairs.map(([discount, outcome], index) => ({
    period,
    ticker: `T${index}`,
    discount,
    outcome,
  }));
}

describe("valuationSkill", () => {
  it("starts from the prior: half strength with no track record", () => {
    expect(valuationSkill([], 28)).toEqual({
      ic: null,
      shrunkIc: "0.05000000",
      confidence: "0.50000000",
      strength: "1.50000000",
      pairs: 0,
      periods: 0,
      pending: 28,
    });
  });

  it("rewards discounts that keep ranking the next year's returns", () => {
    const observations = Array.from({ length: 40 }, (_, q) =>
      quarter(`20${10 + Math.floor(q / 4)}Q${(q % 4) + 1}`, [
        [0.3, 0.15],
        [0.1, 0.05],
        [-0.1, -0.05],
        [-0.3, -0.15],
        [0, 0],
      ]),
    ).flat();
    const skill = valuationSkill(observations, 0);

    expect(skill.ic).toBe("1.00000000");
    expect(skill.pairs).toBe(200);
    // (200 × 1 + 240 × 0.05) / 440 = 0.4818; far above the 0.10 reference.
    expect(skill.confidence).toBe("1.00000000");
    expect(skill.strength).toBe("3.00000000");
  });

  it("switches valuation off when discounts point the wrong way", () => {
    const observations = Array.from({ length: 80 }, (_, q) =>
      quarter(`${2000 + Math.floor(q / 4)}Q${(q % 4) + 1}`, [
        [0.3, -0.15],
        [0.1, -0.05],
        [-0.1, 0.05],
        [-0.3, 0.15],
      ]),
    ).flat();
    const skill = valuationSkill(observations, 0);

    expect(skill.ic).toBe("-1.00000000");
    expect(Number(skill.shrunkIc)).toBeLessThan(0);
    expect(skill.confidence).toBe("0.00000000");
    expect(skill.strength).toBe("0.00000000");
  });

  it("moves slowly away from the prior on thin evidence", () => {
    const skill = valuationSkill(
      quarter("2025Q2", [
        [0.3, 0.15],
        [0.1, 0.05],
        [-0.3, -0.15],
      ]),
      0,
    );

    // (3 × 1 + 240 × 0.05) / 243.
    expect(Number(skill.shrunkIc)).toBeCloseTo(15 / 243, 7);
    expect(Number(skill.confidence)).toBeCloseTo(0.6172839, 6);
  });

  it("ignores market-wide moves and quarters too small to rank", () => {
    const rally = quarter("2025Q2", [
      [0.3, 0.5],
      [0.1, 0.35],
      [-0.1, 0.25],
    ]);
    const tooSmall = quarter("2025Q3", [
      [0.9, -0.9],
      [-0.9, 0.9],
    ]);
    const skill = valuationSkill([...rally, ...tooSmall], 0, {
      ...DEFAULT_SCORE_CONFIG,
      icPriorPairs: 0,
    });

    expect(skill.periods).toBe(1);
    expect(skill.pairs).toBe(3);
    expect(Number(skill.ic)).toBeGreaterThan(0.95);
  });
});
