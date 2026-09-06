import { describe, expect, it } from "vitest";
import { executionPrice, usdBrlExecutionRate } from "./fx-execution";

describe("usdBrlExecutionRate", () => {
  it("applies the 1.5% spread and 0.38% IOF on top of spot", () => {
    // 5 * 1.015 * 1.0038 = 5.094285
    expect(usdBrlExecutionRate("5")).toBe("5.09428500");
  });
});

describe("executionPrice", () => {
  it("leaves a same-currency price untouched", () => {
    expect(executionPrice("33.50", "BRL", "BRL", "5")).toEqual({
      price: "33.50",
      fxApplied: false,
    });
  });

  it("prices a USD asset in BRL at the VET rate", () => {
    expect(executionPrice("100", "USD", "BRL", "5")).toEqual({
      price: "509.43",
      fxApplied: true,
    });
  });

  it("converts a BRL asset into USD at spot, without the VET", () => {
    expect(executionPrice("500", "BRL", "USD", "5")).toEqual({
      price: "100.00",
      fxApplied: false,
    });
  });

  it("stays null without a price or a rate", () => {
    expect(executionPrice(null, "USD", "BRL", "5")).toEqual({
      price: null,
      fxApplied: false,
    });
    expect(executionPrice("100", "USD", "BRL", null)).toEqual({
      price: null,
      fxApplied: false,
    });
  });
});
