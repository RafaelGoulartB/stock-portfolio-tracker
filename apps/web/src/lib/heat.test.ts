import { describe, expect, it } from "vitest";
import { heatTint } from "./heat";

describe("heatTint", () => {
  it("leaves zero, missing and non-finite values neutral", () => {
    expect(heatTint(0, 0.05)).toBeUndefined();
    expect(heatTint(null, 0.05)).toBeUndefined();
    expect(heatTint(Number.NaN, 0.05)).toBeUndefined();
  });

  it("uses the gain token above zero and the loss token below", () => {
    expect(heatTint(0.01, 0.05)).toContain("var(--gain)");
    expect(heatTint(-0.01, 0.05)).toContain("var(--loss)");
  });

  it("grows with the move and saturates at the cap", () => {
    expect(heatTint(0.025, 0.05)).toBe(
      "color-mix(in oklab, var(--gain) 37%, transparent)",
    );
    expect(heatTint(0.05, 0.05)).toBe(heatTint(0.5, 0.05));
    expect(heatTint(-0.5, 0.05)).toBe(
      "color-mix(in oklab, var(--loss) 64%, transparent)",
    );
  });
});
