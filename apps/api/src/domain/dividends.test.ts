import { describe, expect, it } from "vitest";
import type { DividendEvent } from "../lib/dividends";
import { attachDividendEntitlements } from "./dividends";

const createdAt = new Date("2025-01-01T12:00:00Z");

describe("attachDividendEntitlements", () => {
  it("uses the position before the ex-date and excludes ex-date trades", () => {
    const events: DividendEvent[] = [
      {
        id: "event",
        ticker: "AAPL",
        currency: "USD",
        amountPerShare: "0.25",
        declarationDate: null,
        exDate: "2025-06-10",
        recordDate: null,
        paymentDate: "2025-06-15",
        source: "alpha_vantage",
      },
    ];
    const result = attachDividendEntitlements(
      events,
      [
        {
          ticker: "AAPL",
          assetClass: "stock_us",
          currency: "USD",
          side: "buy",
          quantity: "10",
          price: "100",
          fees: "0",
          tradedAt: "2025-05-01",
          createdAt,
        },
        {
          ticker: "AAPL",
          assetClass: "stock_us",
          currency: "USD",
          side: "buy",
          quantity: "5",
          price: "110",
          fees: "0",
          tradedAt: "2025-06-10",
          createdAt,
        },
      ],
      "2025-06-12",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.eligibleQuantity).toBe("10.00000000");
    expect(result[0]?.grossAmount).toBe("2.50");
    expect(result[0]?.status).toBe("scheduled");
  });
});
