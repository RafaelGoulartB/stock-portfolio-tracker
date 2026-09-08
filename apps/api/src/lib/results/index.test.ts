import type { NextResult } from "@portifolio-tracker/shared";
import { describe, expect, it, vi } from "vitest";
import { createResultDateService } from ".";
import type { ResultDateProvider } from "./provider";

const br = {
  ticker: "PETR4",
  assetClass: "stock_br",
  currency: "BRL",
} as const;
const us = { ticker: "AAPL", assetClass: "stock_us", currency: "USD" } as const;
const checkedAt = new Date("2026-09-08T12:00:00.000Z");

function provider(
  implementation: ResultDateProvider["getNextResult"],
): ResultDateProvider {
  return { getNextResult: vi.fn(implementation) };
}

function result(
  ticker: string,
  date: string,
  source: NextResult["source"],
): NextResult {
  return { ticker, date, period: null, source, estimated: false };
}

describe("createResultDateService", () => {
  it("returns a primary result without invoking the fallback", async () => {
    const brazil = provider(async () =>
      result("PETR4", "2026-11-05", "cvm_b3"),
    );
    const fallback = provider(async () =>
      result("PETR4", "2026-11-06", "yahoo"),
    );
    const service = createResultDateService(
      { brazil, unitedStates: provider(async () => null), fallback },
      () => checkedAt,
    );

    await expect(service([br], "2026-09-08")).resolves.toEqual({
      results: [result("PETR4", "2026-11-05", "cvm_b3")],
      checkedAt: checkedAt.toISOString(),
    });
    expect(fallback.getNextResult).not.toHaveBeenCalled();
  });

  it("uses Yahoo when the primary provider fails", async () => {
    const unitedStates = provider(async () => {
      throw new Error("quota");
    });
    const fallback = provider(async () =>
      result("AAPL", "2026-10-30", "yahoo"),
    );
    const service = createResultDateService(
      { brazil: provider(async () => null), unitedStates, fallback },
      () => checkedAt,
    );

    await expect(service([us], "2026-09-08")).resolves.toMatchObject({
      results: [result("AAPL", "2026-10-30", "yahoo")],
    });
  });

  it("contains one asset failure and sorts successful results by date then ticker", async () => {
    const brazil = provider(async (asset) => {
      if (asset.ticker === "FAIL3") throw new Error("offline");
      return result(asset.ticker, "2026-11-05", "cvm_b3");
    });
    const unitedStates = provider(async () =>
      result("AAPL", "2026-10-30", "alpha_vantage"),
    );
    const fallback = provider(async () => null);
    const service = createResultDateService(
      { brazil, unitedStates, fallback },
      () => checkedAt,
    );

    const response = await service(
      [
        br,
        us,
        { ticker: "VALE3", assetClass: "stock_br", currency: "BRL" },
        { ticker: "FAIL3", assetClass: "stock_br", currency: "BRL" },
        { ...br, ticker: "petr4" },
      ],
      "2026-09-08",
    );

    expect(response.results).toEqual([
      result("AAPL", "2026-10-30", "alpha_vantage"),
      result("PETR4", "2026-11-05", "cvm_b3"),
      result("VALE3", "2026-11-05", "cvm_b3"),
    ]);
    expect(brazil.getNextResult).toHaveBeenCalledTimes(3);
  });
});
