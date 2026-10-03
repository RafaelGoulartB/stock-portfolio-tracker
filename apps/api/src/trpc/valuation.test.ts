import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsolidationInput } from "../domain/positions";
import { clearQuoteCache } from "../lib/quotes/yahoo";
import { loadValuedPortfolio } from "./valuation";

const usdBuy: ConsolidationInput = {
  ticker: "AAPL",
  assetClass: "stock_us",
  currency: "USD",
  side: "buy",
  quantity: "2",
  price: "150",
  fees: "0",
  tradedAt: "2026-01-05",
  createdAt: new Date("2026-01-05T12:00:00Z"),
};

describe("loadValuedPortfolio", () => {
  beforeEach(() => {
    clearQuoteCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a missing manual rate before asking for any quote", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const result = loadValuedPortfolio({
      userId: "user-1",
      displayCurrency: "BRL",
      fxSource: "manual",
      quoteSource: "yahoo",
      transactions: [usdBuy],
      storedManualPrices: {},
      includeCash: false,
    });

    await expect(result).rejects.toBeInstanceOf(TRPCError);
    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
