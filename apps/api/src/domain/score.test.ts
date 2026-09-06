import {
  DEFAULT_SCORE_CONFIG,
  type ScoreConfig,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import { formatDecimal } from "../lib/decimal";
import {
  averageGrade,
  gradeMultiplier,
  type ScoreInput,
  scoreAsset,
} from "./score";

const TODAY = "2026-09-06";

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    targetWeight: "0.015",
    currentWeight: "0.01",
    discount: null,
    averageGrade: null,
    lastContributionAt: null,
    today: TODAY,
    ...overrides,
  };
}

function multiplierOf(grade: string | null): string {
  return formatDecimal(gradeMultiplier(grade), 2);
}

describe("gradeMultiplier", () => {
  it("reads the highest band the grade reaches", () => {
    expect(multiplierOf("0")).toBe("0.50");
    expect(multiplierOf("3.99")).toBe("0.50");
    expect(multiplierOf("4")).toBe("0.70");
    expect(multiplierOf("6.5")).toBe("0.70");
    expect(multiplierOf("7")).toBe("0.80");
    expect(multiplierOf("7.99")).toBe("0.80");
    expect(multiplierOf("8")).toBe("1.00");
    expect(multiplierOf("10")).toBe("1.00");
  });

  it("stays neutral without a grade", () => {
    expect(multiplierOf(null)).toBe("1.00");
  });
});

describe("scoreAsset", () => {
  it("scores the remaining gap when nothing blocks the asset", () => {
    const result = scoreAsset(input());

    expect(result.ruleId).toBe("gap-weighted");
    expect(result.gap).toBe("0.00500000");
    expect(result.value).toBe("0.00500000");
    expect(result.blocked).toBe(false);
  });

  it("raises the target by the discount", () => {
    // 1.5% target, 20% discount => 1.8% adjusted target, 0.8pp of gap.
    const result = scoreAsset(input({ discount: "0.2" }));

    expect(result.adjustedTarget).toBe("0.01800000");
    expect(result.value).toBe("0.00800000");
  });

  it("shrinks the gap by the grade band", () => {
    const result = scoreAsset(input({ averageGrade: "5" }));

    expect(result.multiplier).toBe("0.70");
    expect(result.value).toBe("0.00350000");
  });

  it("never scores a negative gap through the normal rule", () => {
    const result = scoreAsset(
      input({ currentWeight: "0.017", targetWeight: "0.015" }),
    );

    expect(result.ruleId).toBe("gap-weighted");
    expect(result.gap).toBe("-0.00200000");
    expect(result.value).toBe("0.00000000");
  });

  it("turns overweight and expensive into a trim signal", () => {
    // 3.5% target, 4.94% weight (> 1.2x target) and a negative discount.
    const result = scoreAsset(
      input({
        targetWeight: "0.035",
        currentWeight: "0.0494",
        discount: "-0.6449",
      }),
    );

    expect(result.ruleId).toBe("trim-overweight");
    expect(result.value).toBe("-0.03697150");
    expect(result.blocked).toBe(false);
  });

  it("keeps the trim rule ahead of the weight cap", () => {
    const result = scoreAsset(
      input({
        targetWeight: "0.05",
        currentWeight: "0.07",
        discount: "-0.1",
      }),
    );

    expect(result.ruleId).toBe("trim-overweight");
  });

  it("blocks past the absolute weight cap", () => {
    const result = scoreAsset(
      input({ targetWeight: "0.08", currentWeight: "0.06" }),
    );

    expect(result.ruleId).toBe("weight-cap");
    expect(result.value).toBe("0.00000000");
    expect(result.blocked).toBe(true);
  });

  it("blocks past the target overweight factor", () => {
    const result = scoreAsset(
      input({ targetWeight: "0.02", currentWeight: "0.027" }),
    );

    expect(result.ruleId).toBe("target-overweight");
    expect(result.blocked).toBe(true);
  });

  it("blocks inside the cooldown and reports when it expires", () => {
    const result = scoreAsset(input({ lastContributionAt: "2026-08-20" }));

    expect(result.ruleId).toBe("cooldown");
    expect(result.daysSinceContribution).toBe(17);
    expect(result.cooldownUntil).toBe("2026-10-04");
  });

  it("releases the asset once the cooldown elapses", () => {
    const result = scoreAsset(input({ lastContributionAt: "2026-07-23" }));

    expect(result.daysSinceContribution).toBe(45);
    expect(result.ruleId).toBe("gap-weighted");
    expect(result.cooldownUntil).toBeNull();
  });

  it("scores nothing without a target weight", () => {
    const result = scoreAsset(
      input({ targetWeight: null, currentWeight: "0.02", discount: "-0.3" }),
    );

    expect(result.ruleId).toBe("no-target");
    expect(result.value).toBe("0.00000000");
    expect(result.gap).toBeNull();
    expect(result.adjustedTarget).toBeNull();
  });

  it("follows a changed config without touching the rules", () => {
    const config: ScoreConfig = {
      ...DEFAULT_SCORE_CONFIG,
      cooldownDays: 10,
      absoluteWeightCap: "0.02",
    };
    const cooled = scoreAsset(
      input({ lastContributionAt: "2026-08-20" }),
      config,
    );
    const capped = scoreAsset(
      input({ targetWeight: "0.04", currentWeight: "0.03" }),
      config,
    );

    expect(cooled.ruleId).toBe("gap-weighted");
    expect(capped.ruleId).toBe("weight-cap");
  });
});

describe("averageGrade", () => {
  it("averages the newest graded quarters inside the window", () => {
    const result = averageGrade([
      { period: "2025Q1", grade: "2" },
      { period: "2025Q2", grade: "10" },
      { period: "2025Q3", grade: "8" },
      { period: "2025Q4", grade: "8" },
      { period: "2026Q1", grade: "6" },
    ]);

    expect(result.quarters).toBe(4);
    expect(result.average).toBe("8.00");
  });

  it("ignores quarters that only carry notes", () => {
    const result = averageGrade([
      { period: "2026Q1", grade: null },
      { period: "2025Q4", grade: "7" },
    ]);

    expect(result).toEqual({ average: "7.00", quarters: 1 });
  });

  it("reports no average when nothing is graded", () => {
    expect(averageGrade([])).toEqual({ average: null, quarters: 0 });
  });
});
