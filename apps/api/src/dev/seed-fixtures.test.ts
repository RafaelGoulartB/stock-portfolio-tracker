import {
  createTransactionInput,
  tickerSchema,
  upsertAllocationAssetInput,
  upsertAssetReviewInput,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  DEV_SEED_ASSETS,
  DEV_SEED_FIXTURES,
  DEV_SEED_REVIEWS,
} from "./seed-fixtures";

describe("dev seed fixtures", () => {
  it("covers at least 25 tickers with mixed research history", () => {
    const tickers = new Set(DEV_SEED_ASSETS.map((asset) => asset.ticker));

    expect(tickers.size).toBeGreaterThanOrEqual(25);
    expect(DEV_SEED_REVIEWS.length).toBeGreaterThanOrEqual(80);
    expect(
      DEV_SEED_REVIEWS.filter((review) => review.fairValue !== null).length,
    ).toBeGreaterThanOrEqual(40);
    expect(
      DEV_SEED_REVIEWS.filter((review) => review.grade !== null).length,
    ).toBeGreaterThanOrEqual(40);
    expect(
      DEV_SEED_REVIEWS.filter((review) => review.notes !== null).length,
    ).toBeGreaterThanOrEqual(30);
    expect(
      new Set(DEV_SEED_REVIEWS.map((review) => review.period)).size,
    ).toBeGreaterThanOrEqual(6);
    expect(
      DEV_SEED_ASSETS.filter((asset) => asset.targetWeight === null).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      DEV_SEED_ASSETS.filter(
        (asset) =>
          !DEV_SEED_FIXTURES.some((trade) => trade.ticker === asset.ticker),
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      DEV_SEED_ASSETS.filter(
        (asset) =>
          !DEV_SEED_REVIEWS.some((review) => review.ticker === asset.ticker),
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("parses every trade, allocation row and review", () => {
    for (const trade of DEV_SEED_FIXTURES) {
      const parsed = createTransactionInput.safeParse(trade);
      expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
    }

    for (const asset of DEV_SEED_ASSETS) {
      const parsed = upsertAllocationAssetInput.safeParse(asset);
      expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
      expect(tickerSchema.safeParse(asset.ticker).success).toBe(true);
    }

    for (const review of DEV_SEED_REVIEWS) {
      const parsed = upsertAssetReviewInput.safeParse(review);
      expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);
    }
  });

  it("keeps one currency per ticker and never sells more than it bought", () => {
    const running = new Map<string, { currency: string; quantity: number }>();

    for (const trade of DEV_SEED_FIXTURES) {
      const current = running.get(trade.ticker);

      if (current) {
        expect(trade.currency).toBe(current.currency);
      }

      const delta = Number(trade.quantity) * (trade.side === "sell" ? -1 : 1);
      const next = (current?.quantity ?? 0) + delta;

      expect(next).toBeGreaterThanOrEqual(0);
      running.set(trade.ticker, {
        currency: trade.currency ?? "BRL",
        quantity: next,
      });
    }
  });

  it("only reviews tickers that are on the allocation list", () => {
    const tickers = new Set(DEV_SEED_ASSETS.map((asset) => asset.ticker));

    for (const review of DEV_SEED_REVIEWS) {
      expect(tickers.has(review.ticker)).toBe(true);
    }

    for (const trade of DEV_SEED_FIXTURES) {
      expect(tickers.has(trade.ticker)).toBe(true);
    }
  });
});
