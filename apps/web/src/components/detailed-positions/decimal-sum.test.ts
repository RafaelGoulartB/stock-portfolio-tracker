import { describe, expect, it } from "vitest";
import { sumDecimalStrings } from "./decimal-sum";

describe("sumDecimalStrings", () => {
  it("sums decimal strings exactly without float drift", () => {
    // 0.1 + 0.2 is the canonical binary-float failure; the string result
    // must stay exact.
    expect(sumDecimalStrings(["0.1", "0.2"])).toBe("0.30");
    expect(sumDecimalStrings(["1234.56", "0.44"])).toBe("1235.00");
  });

  it("treats null, undefined, and blank values as zero", () => {
    expect(sumDecimalStrings(["10.00", null, undefined, ""])).toBe("10.00");
    expect(sumDecimalStrings([null, undefined])).toBe("0.00");
  });

  it("preserves signs and cancels to zero", () => {
    expect(sumDecimalStrings(["100.25", "-100.25"])).toBe("0.00");
    expect(sumDecimalStrings(["-5.50", "-4.50"])).toBe("-10.00");
    expect(sumDecimalStrings(["-0.001", "0.001"])).toBe("0.00");
  });

  it("accumulates high-precision inputs before rounding to display scale", () => {
    // Each value rounds to 0.00 alone, but the exact sum is 0.09 -> 0.09.
    expect(sumDecimalStrings(["0.03", "0.03", "0.03"])).toBe("0.09");
    // Half-up rounding at the display boundary.
    expect(sumDecimalStrings(["0.005"])).toBe("0.01");
    expect(sumDecimalStrings(["0.004"])).toBe("0.00");
  });

  it("keeps full eight-decimal precision internally", () => {
    expect(sumDecimalStrings(["0.00000001", "0.00000001"], 8)).toBe(
      "0.00000002",
    );
    // Fractions beyond the internal scale are truncated, not rounded up here.
    expect(sumDecimalStrings(["0.000000009"], 8)).toBe("0.00000000");
  });

  it("supports a custom display scale", () => {
    expect(sumDecimalStrings(["1.5", "2.5"], 0)).toBe("4");
    expect(sumDecimalStrings(["1.111", "2.222"], 4)).toBe("3.3330");
  });

  it("handles large magnitudes without precision loss", () => {
    expect(sumDecimalStrings(["9999999999.99", "0.01"])).toBe("10000000000.00");
  });
});
