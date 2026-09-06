import { describe, expect, it } from "vitest";
import { add, div, formatDecimal, mul, sub, toDecimal } from "./decimal";

describe("toDecimal", () => {
  it("parses integers, fractions and negatives", () => {
    expect(formatDecimal(toDecimal("10"), 2)).toBe("10.00");
    expect(formatDecimal(toDecimal("10.5"), 2)).toBe("10.50");
    expect(formatDecimal(toDecimal("-3.25"), 2)).toBe("-3.25");
  });

  it("rejects malformed values", () => {
    expect(() => toDecimal("abc")).toThrow();
    expect(() => toDecimal("1.234567891")).toThrow();
  });
});

describe("arithmetic", () => {
  it("adds and subtracts without float drift", () => {
    const total = add(toDecimal("0.1"), toDecimal("0.2"));

    expect(formatDecimal(total, 2)).toBe("0.30");
    expect(formatDecimal(sub(toDecimal("1"), toDecimal("0.9")), 8)).toBe(
      "0.10000000",
    );
  });

  it("multiplies quantity by price exactly", () => {
    expect(formatDecimal(mul(toDecimal("3"), toDecimal("10.35")), 2)).toBe(
      "31.05",
    );
  });

  it("divides with half-up rounding", () => {
    expect(formatDecimal(div(toDecimal("10"), toDecimal("3")), 8)).toBe(
      "3.33333333",
    );
    expect(formatDecimal(div(toDecimal("1"), toDecimal("8")), 2)).toBe("0.13");
  });
});

describe("formatDecimal", () => {
  it("rounds to the requested precision", () => {
    expect(formatDecimal(toDecimal("1.005"), 2)).toBe("1.01");
    expect(formatDecimal(toDecimal("-1.005"), 2)).toBe("-1.01");
    expect(formatDecimal(toDecimal("0"), 2)).toBe("0.00");
  });
});
