import {
  DEFAULT_SCORE_CONFIG,
  type ScoreConfig,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import { formatDecimal, toDecimal } from "../lib/decimal";
import {
  type GradeSignal,
  gradeSignal,
  interpolateGrade,
  quarterAge,
  type ScoreInput,
  scoreAsset,
  scoreAssets,
  valuationTilt,
} from "./score";

/** Last completed quarter is 2026Q2. */
const TODAY = "2026-09-26";
const UNGRADED = gradeSignal([], TODAY);

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    targetWeight: "0.02",
    currentWeight: "0.01",
    fairValue: null,
    marketPrice: null,
    fairValuePeriod: null,
    grade: UNGRADED,
    lastContributionAt: null,
    today: TODAY,
    ...overrides,
  };
}

function priced(price: string, overrides: Partial<ScoreInput> = {}) {
  return input({
    fairValue: "100",
    marketPrice: price,
    fairValuePeriod: "2026Q2",
    ...overrides,
  });
}

function graded(...grades: [string, string][]): GradeSignal {
  return gradeSignal(
    grades.map(([period, grade]) => ({ period, grade })),
    TODAY,
  );
}

function curve(grade: string): string {
  return formatDecimal(
    interpolateGrade(toDecimal(grade), DEFAULT_SCORE_CONFIG.gradeBands),
    3,
  );
}

describe("interpolateGrade", () => {
  it("passes through the configured knots", () => {
    expect(curve("0")).toBe("0.500");
    expect(curve("4")).toBe("0.700");
    expect(curve("7")).toBe("0.800");
    expect(curve("8")).toBe("1.000");
  });

  it("interpolates between knots and holds past the ends", () => {
    expect(curve("2")).toBe("0.600");
    expect(curve("5.5")).toBe("0.750");
    expect(curve("7.5")).toBe("0.900");
    expect(curve("10")).toBe("1.000");
  });

  it("never jumps across a knot", () => {
    // The v1 step function went from ×0.8 to ×1 between 7.99 and 8.
    expect(curve("7.99")).toBe("0.998");
  });
});

describe("quarterAge", () => {
  it("treats the last completed quarter as fresh", () => {
    expect(quarterAge("2026Q2", TODAY)).toBe(0);
    expect(quarterAge("2026Q3", TODAY)).toBe(0);
    expect(quarterAge("2026Q1", TODAY)).toBe(1);
    expect(quarterAge("2025Q2", TODAY)).toBe(4);
  });
});

describe("gradeSignal", () => {
  it("sits exactly on the ungraded multiplier without grades", () => {
    expect(UNGRADED).toEqual({
      average: null,
      quarters: 0,
      evidence: "0.00000000",
      multiplier: "1.00000000",
    });
  });

  it("ignores quarters that only carry notes", () => {
    const signal = gradeSignal(
      [
        { period: "2026Q2", grade: null },
        { period: "2026Q1", grade: "9" },
      ],
      TODAY,
    );

    expect(signal.quarters).toBe(1);
    expect(signal.average).toBe("9.00");
  });

  it("shrinks a single grade toward the ungraded prior", () => {
    // curve(3) = 0.65; one fresh quarter against a one-quarter prior of 1.
    expect(graded(["2026Q2", "3"]).multiplier).toBe("0.82500000");
  });

  it("moves further with more consistent evidence", () => {
    const four = graded(
      ["2026Q2", "3"],
      ["2026Q1", "3"],
      ["2025Q4", "3"],
      ["2025Q3", "3"],
    );
    const multiplier = Number(four.multiplier);

    expect(multiplier).toBeGreaterThan(0.65);
    expect(multiplier).toBeLessThan(0.825);
    expect(multiplier).toBeCloseTo(0.7345, 3);
  });

  it("weights recent quarters more than old ones", () => {
    // Weights 1 (fresh) and 0.5 (a year older): (9 + 0.5 × 3) / 1.5.
    expect(graded(["2026Q2", "9"], ["2025Q2", "3"]).average).toBe("7.00");
  });

  it("reads only the newest quarters inside the window", () => {
    const signal = graded(
      ["2026Q2", "8"],
      ["2026Q1", "8"],
      ["2025Q4", "8"],
      ["2025Q3", "8"],
      ["2025Q2", "0"],
    );

    expect(signal.quarters).toBe(4);
    expect(signal.average).toBe("8.00");
    expect(signal.multiplier).toBe("1.00000000");
  });
});

describe("valuationTilt", () => {
  const ONE = toDecimal("1");

  function tiltAt(
    price: string,
    overrides: Partial<ScoreInput> = {},
    gradeMultiplier = ONE,
  ) {
    const result = valuationTilt(priced(price, overrides), gradeMultiplier);

    return result === null
      ? null
      : {
          signal: formatDecimal(result.signal, 8),
          tilt: formatDecimal(result.tilt, 8),
          confidence: formatDecimal(result.confidence, 8),
        };
  }

  it("is absent without a fair value or a price", () => {
    expect(valuationTilt(input(), ONE)).toBeNull();
    expect(valuationTilt(input({ fairValue: "100" }), ONE)).toBeNull();
  });

  it("ignores mispricing inside the valuation noise band", () => {
    expect(tiltAt("100")?.tilt).toBe("1.00000000");
    expect(tiltAt("97")?.tilt).toBe("1.00000000");
    expect(tiltAt("105")?.tilt).toBe("1.00000000");
  });

  it("tilts by the log mispricing beyond the band", () => {
    // ln(100 / 80) - 0.05 = 0.17314355; exp of it = 1.18903678.
    expect(tiltAt("80")).toEqual({
      signal: "0.17314355",
      tilt: "1.18903678",
      confidence: "1.00000000",
    });
  });

  it("treats half and double the fair value symmetrically", () => {
    const cheap = tiltAt("50");
    const expensive = tiltAt("200");

    expect(Number(cheap?.signal)).toBeCloseTo(-Number(expensive?.signal), 8);
    // exp(0.643) is clamped at the ×1.5 ceiling; exp(-0.643) is not floored.
    expect(cheap?.tilt).toBe("1.50000000");
    expect(expensive?.tilt).toBe("0.52563555");
  });

  it("loses confidence with a stale fair value or a weak grade", () => {
    // Two quarters old at a two-quarter half-life: confidence 0.5.
    expect(tiltAt("80", { fairValuePeriod: "2025Q4" })).toMatchObject({
      confidence: "0.50000000",
      tilt: "1.09042963",
    });
    expect(tiltAt("80", {}, toDecimal("0.5"))?.tilt).toBe("1.09042963");
  });

  it("makes a cheap asset clear the buy cost, but not an expensive one", () => {
    expect(tiltAt("80", { buyCost: "0.03" })?.signal).toBe("0.14358475");
    expect(tiltAt("125", { buyCost: "0.03" })?.signal).toBe("-0.17314355");
  });
});

describe("scoreAsset", () => {
  it("scores the missing share of the target at full priority", () => {
    const result = scoreAsset(input());

    expect(result).toMatchObject({
      ruleId: "gap-weighted",
      value: "0.50000000",
      tiltedTarget: "0.02000000",
      gap: "0.01000000",
      relativeGap: "0.50000000",
      priority: "1.00000000",
      blocked: false,
    });
  });

  it("ranks an empty small target above a nearly full large one", () => {
    const large = scoreAsset(
      input({ targetWeight: "0.10", currentWeight: "0.08" }),
    );
    const small = scoreAsset(
      input({ targetWeight: "0.02", currentWeight: "0" }),
    );

    expect(large.value).toBe("0.20000000");
    expect(small.value).toBe("1.00000000");
  });

  it("moves the target by the valuation tilt", () => {
    const result = scoreAsset(priced("80"));

    expect(result.tilt).toBe("1.18903678");
    expect(result.tiltedTarget).toBe("0.02378074");
    expect(result.valuationConfidence).toBe("1.00000000");
  });

  it("scales priority by the grade, not the destination", () => {
    const result = scoreAsset(input({ grade: graded(["2026Q2", "3"]) }));

    expect(result.tiltedTarget).toBe("0.02000000");
    expect(result.gradeMultiplier).toBe("0.82500000");
    expect(result.value).toBe("0.41250000");
  });

  it("reports the post-contribution weight ceiling", () => {
    expect(scoreAsset(input()).maxWeight).toBe("0.02600000");
    expect(scoreAsset(input({ targetWeight: "0.045" })).maxWeight).toBe(
      "0.05000000",
    );
    expect(scoreAsset(input({ targetWeight: "0.10" })).maxWeight).toBe(
      "0.13000000",
    );
  });

  it("scores nothing without a target weight", () => {
    const result = scoreAsset(priced("50", { targetWeight: null }));

    expect(result).toMatchObject({
      ruleId: "no-target",
      value: "0.00000000",
      tiltedTarget: null,
      maxWeight: null,
    });
  });

  it("blocks a held asset whose weight could not be measured", () => {
    const result = scoreAsset(
      input({ currentWeight: "0", quoteMissing: true }),
    );

    expect(result).toMatchObject({ ruleId: "no-quote", blocked: true });
  });

  it("turns expensive and past the trim band into a trim signal", () => {
    // Tilted target 5% × 0.52563555; weight 9% is far past it.
    const result = scoreAsset(
      priced("200", { targetWeight: "0.05", currentWeight: "0.09" }),
    );

    expect(result.ruleId).toBe("trim-overweight");
    expect(result.tiltedTarget).toBe("0.02628178");
    expect(Number(result.value)).toBeCloseTo(-2.4244, 3);
  });

  it("stays inside the tolerance band without a trim", () => {
    // Tilted target 8.41%; 10% is 1.59 p.p. past it, inside 25% of target.
    const result = scoreAsset(
      priced("125", { targetWeight: "0.10", currentWeight: "0.10" }),
    );

    expect(result.ruleId).toBe("gap-weighted");
    expect(result.value).toBe("0.00000000");
  });

  it("never trims an asset that is not expensive", () => {
    const result = scoreAsset(
      priced("100", { targetWeight: "0.05", currentWeight: "0.09" }),
    );

    expect(result).toMatchObject({ ruleId: "weight-cap", blocked: true });
  });

  it("honors an explicit target above the absolute weight cap", () => {
    const result = scoreAsset(
      input({ targetWeight: "0.08", currentWeight: "0.06" }),
    );

    expect(result.ruleId).toBe("gap-weighted");
    expect(result.value).toBe("0.25000000");
  });

  it("blocks past the target overweight factor", () => {
    const result = scoreAsset(
      input({ targetWeight: "0.10", currentWeight: "0.14" }),
    );

    expect(result).toMatchObject({
      ruleId: "target-overweight",
      blocked: true,
    });
  });

  it("treats anything held against a zero target as surplus", () => {
    const result = scoreAsset(
      input({ targetWeight: "0", currentWeight: "0.01" }),
    );

    expect(result.relativeGap).toBe("-1.00000000");
    expect(result.blocked).toBe(true);
  });

  it("lowers priority inside the cooldown instead of blocking", () => {
    // Six days into 45: 0.25 + 0.75 × 6/45 = 0.35.
    const result = scoreAsset(
      input({
        targetWeight: "0.05",
        currentWeight: "0.02",
        lastContributionAt: "2026-09-20",
      }),
    );

    expect(result).toMatchObject({
      ruleId: "cooldown",
      blocked: false,
      recencyMultiplier: "0.35000000",
      value: "0.21000000",
      daysSinceContribution: 6,
      cooldownUntil: "2026-11-04",
    });
  });

  it("restores full priority once the cooldown elapses", () => {
    const result = scoreAsset(input({ lastContributionAt: "2026-08-12" }));

    expect(result).toMatchObject({
      ruleId: "gap-weighted",
      recencyMultiplier: "1.00000000",
      cooldownUntil: null,
    });
  });

  it("follows a changed config without touching the rules", () => {
    const config: ScoreConfig = {
      ...DEFAULT_SCORE_CONFIG,
      cooldownFloor: "0",
      valuationSensitivity: "0",
    };
    const result = scoreAsset(
      priced("50", {
        targetWeight: "0.05",
        currentWeight: "0.02",
        lastContributionAt: "2026-09-20",
      }),
      config,
    );

    expect(result.tilt).toBe("1.00000000");
    expect(result.recencyMultiplier).toBe("0.13333333");
  });
});

describe("scoreAssets", () => {
  it("renormalizes tilts so targets keep their assigned sum", () => {
    const [cheap, plain] = scoreAssets([
      priced("50", { targetWeight: "0.5", currentWeight: "0.5" }),
      input({ targetWeight: "0.5", currentWeight: "0.5" }),
    ]);

    // Raw tilts 1.5 and 1: normalizer 1 / 1.25.
    expect(cheap?.tiltedTarget).toBe("0.60000000");
    expect(plain?.tiltedTarget).toBe("0.40000000");
    expect(plain?.tilt).toBe("0.80000000");
  });

  it("keeps the residual cash target out of the tilt", () => {
    const [cheap, cash] = scoreAssets([
      priced("50", { targetWeight: "0.9", currentWeight: "0.8" }),
      input({ targetWeight: "0.1", currentWeight: "0.2", tiltable: false }),
    ]);

    expect(cheap?.tiltedTarget).toBe("0.90000000");
    expect(cash?.tiltedTarget).toBe("0.10000000");
    expect(cash?.valuationSignal).toBeNull();
  });
});

describe("score invariants", () => {
  it("never scores a cheaper price lower", () => {
    let previous = Number.NEGATIVE_INFINITY;

    for (let price = 200; price >= 40; price -= 2.5) {
      const value = Number(
        scoreAsset(
          priced(String(price), {
            targetWeight: "0.05",
            currentWeight: "0.03",
          }),
        ).value,
      );

      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("never lowers or jumps the priority as a grade rises", () => {
    let previous = 0;

    for (let grade = 0; grade <= 10; grade += 0.25) {
      const multiplier = Number(
        graded(["2026Q2", grade.toFixed(2)], ["2026Q1", grade.toFixed(2)])
          .multiplier,
      );

      expect(multiplier).toBeGreaterThanOrEqual(previous);
      if (grade > 0) expect(multiplier - previous).toBeLessThanOrEqual(0.051);
      previous = multiplier;
    }
  });
});
