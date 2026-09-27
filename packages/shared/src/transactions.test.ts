import { describe, expect, it } from "vitest";
import { createTransactionInput, tradesInWholeUnits } from "./transactions";

const trade = {
  ticker: "cost",
  assetClass: "stock_us",
  currency: "USD",
  side: "buy",
  quantity: "2",
  price: "900",
  fees: "0",
  tradedAt: "2025-01-20",
} as const;

describe("createTransactionInput", () => {
  it("accepts the form's blank fixed-income value and trade rate", () => {
    const parsed = createTransactionInput.parse({
      ...trade,
      value: "",
      usdBrlRate: "",
    });

    expect(parsed).toMatchObject({ ticker: "COST", price: "900" });
    expect(parsed.value).toBeUndefined();
    expect(parsed.usdBrlRate).toBeUndefined();
  });

  it("keeps an explicit trade-date rate and rejects a zero one", () => {
    expect(
      createTransactionInput.parse({ ...trade, usdBrlRate: "6.0498" })
        .usdBrlRate,
    ).toBe("6.0498");
    expect(
      createTransactionInput.safeParse({ ...trade, usdBrlRate: "0" }).success,
    ).toBe(false);
  });

  it("still requires a value for fixed income", () => {
    expect(
      createTransactionInput.safeParse({
        ticker: "Tesouro Selic 2031",
        assetClass: "fixed_income",
        currency: "BRL",
        value: "",
        tradedAt: "2025-01-20",
      }).success,
    ).toBe(false);
  });
});

describe("tradesInWholeUnits", () => {
  it("rounds B3 listings held in BRL, never US shares or crypto", () => {
    expect(tradesInWholeUnits("stock_br", "BRL")).toBe(true);
    expect(tradesInWholeUnits("reit", "BRL")).toBe(true);
    expect(tradesInWholeUnits("bdr", "BRL")).toBe(true);
    expect(tradesInWholeUnits("etf", "USD")).toBe(false);
    expect(tradesInWholeUnits("stock_us", "USD")).toBe(false);
    expect(tradesInWholeUnits("crypto", "BRL")).toBe(false);
  });
});
