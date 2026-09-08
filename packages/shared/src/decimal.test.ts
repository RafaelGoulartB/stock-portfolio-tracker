import { describe, expect, it } from "vitest";
import { currencySchema, DEFAULT_CURRENCY } from "./currency";
import { isoDate, nonNegativeDecimal, positiveDecimal } from "./decimal";

describe("nonNegativeDecimal", () => {
  it("accepts zero, integers and up to eight decimal places", () => {
    expect(nonNegativeDecimal.parse("0")).toBe("0");
    expect(nonNegativeDecimal.parse("42")).toBe("42");
    expect(nonNegativeDecimal.parse("1.23456789")).toBe("1.23456789");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(nonNegativeDecimal.parse("  10.5  ")).toBe("10.5");
  });

  it("rejects more than eight decimal places and non-decimal text", () => {
    expect(nonNegativeDecimal.safeParse("1.123456789").success).toBe(false);
    expect(nonNegativeDecimal.safeParse("abc").success).toBe(false);
    expect(nonNegativeDecimal.safeParse("-1").success).toBe(false);
  });
});

describe("positiveDecimal", () => {
  it("accepts strictly positive values", () => {
    expect(positiveDecimal.parse("0.00000001")).toBe("0.00000001");
    expect(positiveDecimal.parse("100")).toBe("100");
  });

  it("rejects zero and zero-with-fraction", () => {
    expect(positiveDecimal.safeParse("0").success).toBe(false);
    expect(positiveDecimal.safeParse("0.00").success).toBe(false);
  });
});

describe("isoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isoDate.parse("2026-01-31")).toBe("2026-01-31");
    expect(isoDate.parse("2024-02-29")).toBe("2024-02-29");
  });

  it("rejects malformed and impossible dates", () => {
    expect(isoDate.safeParse("2026-1-1").success).toBe(false);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("2025-02-29").success).toBe(false);
    expect(isoDate.safeParse("2026-13-01").success).toBe(false);
  });
});

describe("currencySchema", () => {
  it("accepts the two supported currencies", () => {
    expect(currencySchema.parse("BRL")).toBe("BRL");
    expect(currencySchema.parse("USD")).toBe("USD");
  });

  it("rejects unsupported currencies and defaults to BRL", () => {
    expect(currencySchema.safeParse("EUR").success).toBe(false);
    expect(DEFAULT_CURRENCY).toBe("BRL");
  });
});
