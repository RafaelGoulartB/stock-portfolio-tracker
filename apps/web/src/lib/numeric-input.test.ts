import { describe, expect, it } from "vitest";
import {
  formatDecimalInput,
  formatPercentInput,
  parseDecimalInput,
  parsePercentInput,
  shiftDecimalPoint,
} from "./numeric-input";

describe("shiftDecimalPoint", () => {
  it("moves the point right and left without float error", () => {
    expect(shiftDecimalPoint("1.5", 2)).toBe("150");
    expect(shiftDecimalPoint("1.5", -2)).toBe("0.015");
    expect(shiftDecimalPoint("100", -2)).toBe("1");
  });

  it("preserves the sign", () => {
    expect(shiftDecimalPoint("-2.5", -2)).toBe("-0.025");
  });
});

describe("parseDecimalInput", () => {
  it("accepts both decimal separators", () => {
    expect(parseDecimalInput("23,55")).toBe("23.55");
    expect(parseDecimalInput("23.55")).toBe("23.55");
  });

  it("treats the rightmost separator as the decimal point", () => {
    expect(parseDecimalInput("1.234,56")).toBe("1234.56");
    expect(parseDecimalInput("1,234.56")).toBe("1234.56");
  });

  it("strips percent signs and whitespace", () => {
    expect(parseDecimalInput(" 1.5% ")).toBe("1.5");
  });

  it("keeps negatives and caps eight fraction digits", () => {
    expect(parseDecimalInput("-23,55")).toBe("-23.55");
    expect(parseDecimalInput("0.123456789")).toBe("0.12345678");
  });

  it("returns null for empty or non-numeric input", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput("-")).toBeNull();
  });
});

describe("parsePercentInput", () => {
  it("turns a typed percent into its ratio", () => {
    expect(parsePercentInput("1,5")).toBe("0.015");
    expect(parsePercentInput("100")).toBe("1");
  });

  it("returns null for invalid input", () => {
    expect(parsePercentInput("abc")).toBeNull();
  });
});

describe("formatPercentInput", () => {
  it("renders a ratio as an editable percent in the given locale", () => {
    expect(formatPercentInput("0.015", "en")).toBe("1.5");
    expect(formatPercentInput("0.015", "pt-BR")).toBe("1,5");
  });

  it("returns an empty string for null", () => {
    expect(formatPercentInput(null, "en")).toBe("");
  });
});

describe("formatDecimalInput", () => {
  it("renders a decimal with the locale separator", () => {
    expect(formatDecimalInput("8.5", "en")).toBe("8.5");
    expect(formatDecimalInput("8.5", "pt-BR")).toBe("8,5");
  });

  it("returns an empty string for null", () => {
    expect(formatDecimalInput(null, "en")).toBe("");
  });
});
