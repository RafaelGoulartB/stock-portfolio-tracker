import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatTradeDate,
  formatWeight,
  formatWeightPrecise,
  pnlClassName,
  signOf,
} from "./format";

describe("formatMoney", () => {
  it("formats BRL and USD in the given locale", () => {
    expect(formatMoney("1234.5", "BRL", "pt-BR")).toBe("R$\u00a01.234,50");
    expect(formatMoney("1234.5", "USD", "en")).toBe("$1,234.50");
  });
});

describe("formatSignedMoney", () => {
  it("prefixes a plus sign for non-negative values", () => {
    expect(formatSignedMoney("10", "USD", "en")).toBe("+$10.00");
    expect(formatSignedMoney("-10", "USD", "en")).toBe("-$10.00");
  });
});

describe("formatQuantity", () => {
  it("drops trailing fraction zeros and groups the whole part", () => {
    expect(formatQuantity("2800.00", "en")).toBe("2,800");
    expect(formatQuantity("4.780", "en")).toBe("4.78");
    expect(formatQuantity("4.5", "pt-BR")).toBe("4,5");
  });
});

describe("weight and percent formatting", () => {
  it("renders weights and signed percents", () => {
    expect(formatWeight("0.1234", "en")).toBe("12.3%");
    expect(formatWeightPrecise("0.0146", "en")).toBe("1.46%");
    expect(formatSignedPercent("0.1", "en")).toBe("+10.0%");
    expect(formatSignedPercent("-0.1", "en")).toBe("-10.0%");
  });
});

describe("formatTradeDate", () => {
  it("renders an ISO date, stable across the API timezone", () => {
    expect(formatTradeDate("2026-01-02", "en")).toBe("Jan 02, 2026");
  });

  it("returns the raw value when the date is malformed", () => {
    expect(formatTradeDate("not-a-date", "en")).toBe("not-a-date");
  });
});

describe("signOf and pnlClassName", () => {
  it("classifies signs", () => {
    expect(signOf("-1")).toBe("negative");
    expect(signOf("0")).toBe("zero");
    expect(signOf("1")).toBe("positive");
  });

  it("maps signs to semantic classes", () => {
    expect(pnlClassName("1")).toBe("text-gain");
    expect(pnlClassName("-1")).toBe("text-loss");
    expect(pnlClassName("0")).toBe("text-muted-foreground");
  });
});
