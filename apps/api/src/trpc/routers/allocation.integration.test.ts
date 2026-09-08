import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as client, db } from "../../db";
import { assetCategories, categories, users } from "../../db/schema";
import type { Context } from "../context";
import { allocationRouter } from "./allocation";

/**
 * Opt-in Postgres integration coverage for the allocation metadata write.
 * The category assignment must be account-scoped and saved with the asset;
 * clearing it must remove the assignment without removing the asset.
 */
const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

function callerFor(userId: string) {
  const ctx = {
    user: { id: userId, email: `${userId}@integration.test` },
  } as unknown as Context;

  return allocationRouter.createCaller(ctx);
}

async function withUser(
  body: (userId: string) => Promise<void>,
): Promise<void> {
  const [created] = await db
    .insert(users)
    .values({
      email: `integration-${randomUUID()}@integration.test`,
      passwordHash: "integration-test-not-a-real-hash",
    })
    .returning({ id: users.id });

  if (!created) {
    throw new Error("failed to provision integration test user");
  }

  try {
    await body(created.id);
  } finally {
    await db.delete(users).where(eq(users.id, created.id));
  }
}

describeIntegration("allocation router (Postgres integration)", () => {
  beforeAll(async () => {
    await db.execute(sql`SELECT 1 FROM allocation_assets LIMIT 1`);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("assigns and clears a watch asset category within the account", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const [category] = await db
        .insert(categories)
        .values({
          userId,
          name: `Integration ${randomUUID()}`,
        })
        .returning({ id: categories.id });

      if (!category) {
        throw new Error("failed to provision integration category");
      }

      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await caller.upsertAsset({
        ticker,
        assetClass: "stock_us",
        currency: "USD",
        categoryId: category.id,
      });

      expect(created?.ticker).toBe(ticker);

      const assigned = await db
        .select({ categoryId: assetCategories.categoryId })
        .from(assetCategories)
        .where(
          and(
            eq(assetCategories.userId, userId),
            eq(assetCategories.ticker, ticker),
          ),
        );
      expect(assigned).toEqual([{ categoryId: category.id }]);

      await caller.upsertAsset({ ticker, categoryId: null });

      const cleared = await db
        .select({ ticker: assetCategories.ticker })
        .from(assetCategories)
        .where(
          and(
            eq(assetCategories.userId, userId),
            eq(assetCategories.ticker, ticker),
          ),
        );
      expect(cleared).toEqual([]);
    });
  });

  it("rejects a category owned by another account", async () => {
    await withUser(async (userId) => {
      const [owner] = await db
        .insert(users)
        .values({
          email: `integration-${randomUUID()}@integration.test`,
          passwordHash: "integration-test-not-a-real-hash",
        })
        .returning({ id: users.id });

      if (!owner) {
        throw new Error("failed to provision category owner");
      }

      try {
        const [category] = await db
          .insert(categories)
          .values({
            userId: owner.id,
            name: `Integration ${randomUUID()}`,
          })
          .returning({ id: categories.id });

        if (!category) {
          throw new Error("failed to provision foreign category");
        }

        const caller = callerFor(userId);
        await expect(
          caller.upsertAsset({
            ticker: `INTG${randomUUID().slice(0, 8).toUpperCase()}`,
            categoryId: category.id,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await db.delete(users).where(eq(users.id, owner.id));
      }
    });
  });
});
