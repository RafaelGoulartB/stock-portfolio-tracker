import { describe, expect, it } from "vitest";
import {
  categoryNameTaken,
  mergeAssetUniverse,
  nextCategoryColor,
} from "./categories";

describe("mergeAssetUniverse", () => {
  it("lets a traded identity win over a watch-only row", () => {
    const merged = mergeAssetUniverse(
      [{ ticker: "PETR4", assetClass: "stock_br", currency: "BRL" }],
      [{ ticker: "PETR4", assetClass: "other", currency: "USD" }],
      ["PETR4"],
    );

    expect(merged).toEqual([
      {
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
        traded: true,
      },
    ]);
  });

  it("keeps watch-only tickers that were never traded", () => {
    const merged = mergeAssetUniverse(
      [],
      [{ ticker: "AAPL", assetClass: "stock_us", currency: "USD" }],
      [],
    );

    expect(merged).toEqual([
      {
        ticker: "AAPL",
        assetClass: "stock_us",
        currency: "USD",
        traded: false,
      },
    ]);
  });

  it("keeps a leftover assignment when the ticker left the log", () => {
    const merged = mergeAssetUniverse([], [], ["ORPHAN"]);

    expect(merged).toEqual([
      {
        ticker: "ORPHAN",
        assetClass: "other",
        currency: "USD",
        traded: false,
      },
    ]);
  });

  it("sorts tickers alphabetically", () => {
    const merged = mergeAssetUniverse(
      [
        { ticker: "VALE3", assetClass: "stock_br", currency: "BRL" },
        { ticker: "ITUB4", assetClass: "stock_br", currency: "BRL" },
      ],
      [],
      [],
    );

    expect(merged.map((row) => row.ticker)).toEqual(["ITUB4", "VALE3"]);
  });
});

describe("nextCategoryColor", () => {
  it("cycles through the chart tokens", () => {
    expect(nextCategoryColor(0)).toBe("chart-1");
    expect(nextCategoryColor(9)).toBe("chart-10");
    expect(nextCategoryColor(10)).toBe("chart-1");
  });
});

describe("categoryNameTaken", () => {
  const existing = [
    { id: "a", name: "Growth" },
    { id: "b", name: "Income" },
  ];

  it("treats names as case-insensitive", () => {
    expect(categoryNameTaken("growth", existing)).toBe(true);
    expect(categoryNameTaken("Core", existing)).toBe(false);
  });

  it("ignores the row being renamed", () => {
    expect(categoryNameTaken("Growth", existing, "a")).toBe(false);
    expect(categoryNameTaken("Income", existing, "a")).toBe(true);
  });
});
