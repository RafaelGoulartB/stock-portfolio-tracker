import { describe, expect, it, vi } from "vitest";
import { firstSuccessfulDividends } from ".";
import type { DividendEvent, DividendProvider } from "./provider";
import { DividendUnavailableError } from "./provider";

const request = {
  ticker: "AAPL",
  assetClass: "stock_us" as const,
  currency: "USD" as const,
  start: "2025-01-01",
  end: "2026-09-08",
};

const event: DividendEvent = {
  id: "alpha:AAPL:2026-05-01:0.25",
  ticker: "AAPL",
  currency: "USD",
  amountPerShare: "0.25000000",
  declarationDate: "2026-04-01",
  exDate: "2026-05-01",
  recordDate: "2026-05-02",
  paymentDate: "2026-05-08",
  source: "alpha_vantage",
};

function provider(
  implementation: DividendProvider["getDividends"],
): DividendProvider {
  return {
    id: "yahoo",
    label: "test",
    getDividends: vi.fn(implementation),
  };
}

describe("firstSuccessfulDividends", () => {
  it("merges fallback events while retaining the primary duplicate", async () => {
    const primary = provider(async () => [event]);
    const fallbackOnly = {
      ...event,
      id: "yahoo:AAPL:2026-02-01:0.24",
      exDate: "2026-02-01",
      amountPerShare: "0.24000000",
      source: "yahoo" as const,
      declarationDate: null,
      recordDate: null,
      paymentDate: null,
    };
    const fallback = provider(async () => [
      { ...event, id: "yahoo-duplicate", source: "yahoo" },
      fallbackOnly,
    ]);

    await expect(
      firstSuccessfulDividends(request, [primary, fallback]),
    ).resolves.toEqual([event, fallbackOnly]);
    expect(fallback.getDividends).toHaveBeenCalledOnce();
  });

  it("uses the fallback when the primary provider fails", async () => {
    const primary = provider(async () => {
      throw new DividendUnavailableError("AAPL", "quota");
    });
    const fallback = provider(async () => [event]);

    await expect(
      firstSuccessfulDividends(request, [primary, fallback]),
    ).resolves.toEqual([event]);
    expect(primary.getDividends).toHaveBeenCalledOnce();
    expect(fallback.getDividends).toHaveBeenCalledOnce();
  });

  it("continues to the fallback after an empty primary response", async () => {
    const primary = provider(async () => []);
    const fallback = provider(async () => [event]);

    await expect(
      firstSuccessfulDividends(request, [primary, fallback]),
    ).resolves.toEqual([event]);
    expect(fallback.getDividends).toHaveBeenCalledOnce();
  });
});
