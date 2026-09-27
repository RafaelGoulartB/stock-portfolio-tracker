import {
  DEFAULT_SCORE_CONFIG,
  type ScoreConfig,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import { formatDecimal, toDecimal, ZERO } from "../lib/decimal";
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

  it("is neutral at fair value and has no dead zone around it", () => {
    expect(tiltAt("100")?.tilt).toBe("1.00000000");
    // A 3% discount already tilts a little: exp(1.5 × ln(100/97)).
    expect(Number(tiltAt("97")?.tilt)).toBeCloseTo(1.04674862, 7);
  });

  it("tilts by the log mispricing at the prior strength", () => {
    // Prior strength 3 × 0.05 / 0.10 = 1.5; exp(1.5 × ln(1.25)).
    const result = tiltAt("80");

    expect(result?.signal).toBe("0.22314355");
    expect(result?.confidence).toBe("1.00000000");
    expect(Number(result?.tilt)).toBeCloseTo(1.39754249, 7);
  });

  it("treats half and double the fair value symmetrically", () => {
    const cheap = tiltAt("50");
    const expensive = tiltAt("200");

    expect(Number(cheap?.signal)).toBeCloseTo(-Number(expensive?.signal), 8);
    expect(Number(cheap?.tilt)).toBeCloseTo(2.82842712, 7);
    expect(Number(expensive?.tilt)).toBeCloseTo(0.35355339, 7);
  });

  it("clamps the tilt to the configured range", () => {
    expect(tiltAt("20")?.tilt).toBe("3.00000000");
    expect(tiltAt("500")?.tilt).toBe("0.20000000");
  });

  it("loses confidence with a stale fair value or a weak grade", () => {
    // Two quarters old at a two-quarter half-life: confidence 0.5.
    const stale = tiltAt("80", { fairValuePeriod: "2025Q4" });

    expect(stale?.confidence).toBe("0.50000000");
    expect(Number(stale?.tilt)).toBeCloseTo(1.18217701, 7);
    expect(Number(tiltAt("80", {}, toDecimal("0.5"))?.tilt)).toBeCloseTo(
      1.18217701,
      7,
    );
  });

  it("scales with the learned valuation strength", () => {
    const off = valuationTilt(priced("80"), ONE, DEFAULT_SCORE_CONFIG, ZERO);
    const full = valuationTilt(
      priced("80"),
      ONE,
      DEFAULT_SCORE_CONFIG,
      toDecimal("3"),
    );

    expect(off && formatDecimal(off.tilt, 8)).toBe("1.00000000");
    // exp(3 × ln(1.25)) = 1.25³.
    expect(full && Number(formatDecimal(full.tilt, 8))).toBeCloseTo(
      1.953125,
      6,
    );
  });

  it("makes a cheap asset clear the buy cost, but not an expensive one", () => {
    expect(tiltAt("80", { buyCost: "0.03" })?.signal).toBe("0.19358475");
    expect(tiltAt("125", { buyCost: "0.03" })?.signal).toBe("-0.22314355");
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

    expect(Number(result.tilt)).toBeCloseTo(1.39754249, 7);
    expect(Number(result.tiltedTarget)).toBeCloseTo(0.02795085, 7);
    expect(result.valuationConfidence).toBe("1.00000000");
  });

  it("scales priority by the grade, not the destination", () => {
    const result = scoreAsset(input({ grade: graded(["2026Q2", "3"]) }));

    expect(result.tiltedTarget).toBe("0.02000000");
    expect(result.gradeMultiplier).toBe("0.82500000");
    expect(result.value).toBe("0.41250000");
  });

  it("reports the post-contribution weight ceiling", () => {
    // Twice the target, and never past 5% for a target at or below 5%.
    expect(scoreAsset(input()).maxWeight).toBe("0.04000000");
    expect(scoreAsset(input({ targetWeight: "0.045" })).maxWeight).toBe(
      "0.05000000",
    );
    expect(scoreAsset(input({ targetWeight: "0.10" })).maxWeight).toBe(
      "0.20000000",
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
    // Tilted target 5% × 0.35355339; weight 9% is far past it.
    const result = scoreAsset(
      priced("200", { targetWeight: "0.05", currentWeight: "0.09" }),
    );

    expect(result.ruleId).toBe("trim-overweight");
    expect(Number(result.tiltedTarget)).toBeCloseTo(0.01767767, 7);
    expect(Number(result.value)).toBeCloseTo(-4.0912, 3);
  });

  it("stays inside the tolerance band without a trim", () => {
    // Tilted target 8.67%; 10% is 1.33 p.p. past it, inside 25% of target.
    const result = scoreAsset(
      priced("110", { targetWeight: "0.10", currentWeight: "0.10" }),
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
      input({ targetWeight: "0.10", currentWeight: "0.21" }),
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
  it("renormalizes valuation only among assets with a fair value", () => {
    const [cheap, fair, unvalued] = scoreAssets([
      priced("50", { targetWeight: "0.4", currentWeight: "0.4" }),
      priced("100", { targetWeight: "0.4", currentWeight: "0.4" }),
      input({ targetWeight: "0.2", currentWeight: "0.2" }),
    ]);

    // Raw tilts 2.83 and 1 share the 80% the valued assets were assigned.
    expect(Number(cheap?.tiltedTarget)).toBeCloseTo(0.5910369, 6);
    expect(Number(fair?.tiltedTarget)).toBeCloseTo(0.2089631, 6);
    // No fair value, no valuation tilt: the ETF-like asset keeps its 20%.
    expect(unvalued?.tiltedTarget).toBe("0.20000000");
    expect(
      Number(cheap?.tiltedTarget) +
        Number(fair?.tiltedTarget) +
        Number(unvalued?.tiltedTarget),
    ).toBeCloseTo(1, 7);
  });

  it("never trims a barely expensive asset because another one is cheap", () => {
    const [cheap, barely] = scoreAssets([
      priced("50", { targetWeight: "0.4", currentWeight: "0.4" }),
      priced("101", { targetWeight: "0.4", currentWeight: "0.4" }),
    ]);

    // Renormalization shrinks the barely expensive target to ~21%…
    expect(Number(barely?.tiltedTarget)).toBeLessThan(0.22);
    // …but a trim may only take it down to its own tilt: 40% × (100/101)^1.5.
    expect(Number(barely?.trimTarget)).toBeCloseTo(0.4 * (100 / 101) ** 1.5, 6);
    expect(barely?.ruleId).not.toBe("trim-overweight");
    expect(cheap?.trimTarget).toBe(cheap?.tiltedTarget);
  });

  it("keeps an extreme stored momentum weight from overflowing", () => {
    const book = scoreAssets(
      [
        input({ targetWeight: "0.5", currentWeight: "0.5", momentum: "-0.5" }),
        input({ targetWeight: "0.5", currentWeight: "0.5", momentum: "0.5" }),
      ],
      { ...DEFAULT_SCORE_CONFIG, momentumWeight: "30" },
    );

    expect(book).toHaveLength(2);
    expect(
      Number(book[0]?.tiltedTarget) + Number(book[1]?.tiltedTarget),
    ).toBeCloseTo(1, 7);
  });

  it("returns a single valued asset's target exactly", () => {
    const [only] = scoreAssets([
      priced("50", { targetWeight: "0.3", currentWeight: "0.1" }),
    ]);

    expect(only?.tiltedTarget).toBe("0.30000000");
    expect(only?.valuationTilt).toBe("1.00000000");
  });

  it("tilts gently by momentum and keeps the sum", () => {
    const [falling, flat, rising] = scoreAssets([
      input({ targetWeight: "0.3", currentWeight: "0.3", momentum: "-0.2" }),
      input({ targetWeight: "0.3", currentWeight: "0.3", momentum: "0" }),
      input({ targetWeight: "0.4", currentWeight: "0.4", momentum: "0.2" }),
    ]);

    expect(Number(falling?.momentumZ)).toBeCloseTo(-1.2247449, 6);
    expect(flat?.momentumZ).toBe("0.00000000");
    expect(Number(rising?.momentumTilt)).toBeGreaterThan(1);
    expect(Number(falling?.momentumTilt)).toBeLessThan(1);
    // exp(0.10 × ±1.22): a tie-breaker, not a bet.
    expect(Number(rising?.momentumTilt)).toBeLessThan(1.14);
    expect(
      Number(falling?.tiltedTarget) +
        Number(flat?.tiltedTarget) +
        Number(rising?.tiltedTarget),
    ).toBeCloseTo(1, 7);
  });

  it("caps the momentum z-score so one outlier cannot dominate", () => {
    const book = scoreAssets(
      Array.from({ length: 10 }, (_, index) =>
        input({
          targetWeight: "0.1",
          currentWeight: "0.1",
          momentum: index === 9 ? "10" : "0",
        }),
      ),
    );

    // Uncapped the outlier would sit 3 deviations out.
    expect(book[9]?.momentumZ).toBe("2.00000000");
  });

  it("gives no momentum signal to cash or unpriced holdings", () => {
    const [cash, unpriced, a, b] = scoreAssets([
      input({
        targetWeight: "0.1",
        currentWeight: "0.1",
        tiltable: false,
        momentum: "0.5",
      }),
      input({
        targetWeight: "0.2",
        currentWeight: "0",
        quoteMissing: true,
        momentum: "0.9",
      }),
      input({ targetWeight: "0.35", currentWeight: "0.3", momentum: "0.1" }),
      input({ targetWeight: "0.35", currentWeight: "0.3", momentum: "-0.1" }),
    ]);

    expect(cash?.momentumZ).toBeNull();
    expect(cash?.tiltedTarget).toBe("0.10000000");
    expect(unpriced?.momentumZ).toBeNull();
    expect(Number(a?.momentumZ)).toBeCloseTo(1, 7);
    expect(Number(b?.momentumZ)).toBeCloseTo(-1, 7);
  });

  it("asks for a fresh valuation when the price drifted past the band", () => {
    const [moved, calm] = scoreAssets([
      priced("130", { referencePrice: "100" }),
      priced("110", { referencePrice: "100" }),
    ]);

    expect(moved?.priceSinceFairValue).toBe("0.30000000");
    expect(moved?.reviewSuggested).toBe(true);
    expect(calm?.reviewSuggested).toBe(false);
    expect(scoreAsset(priced("50")).reviewSuggested).toBe(false);
  });

  it("uses the learned valuation strength for the whole book", () => {
    const [muted] = scoreAssets(
      [
        priced("50", { targetWeight: "0.5" }),
        priced("100", { targetWeight: "0.5" }),
      ],
      DEFAULT_SCORE_CONFIG,
      { valuationStrength: "0" },
    );

    expect(muted?.tiltedTarget).toBe("0.50000000");
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
