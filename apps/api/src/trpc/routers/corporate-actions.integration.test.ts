import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as client, db } from "../../db";
import { users } from "../../db/schema";
import type { Context } from "../context";
import { corporateActionsRouter } from "./corporate-actions";
import { transactionsRouter } from "./transactions";

/**
 * Opt-in Postgres coverage for splits: they must scale the ledger for the
 * oversell guards, stay account-scoped, and refuse removals that would
 * uncover sales recorded in the new units. Each test owns an ephemeral user.
 */
const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

function callers(userId: string) {
  const ctx = {
    user: { id: userId, email: `${userId}@integration.test` },
  } as unknown as Context;

  return {
    splits: corporateActionsRouter.createCaller(ctx),
    trades: transactionsRouter.createCaller(ctx),
  };
}

async function withUser(body: (userId: string) => Promise<void>) {
  const [created] = await db
    .insert(users)
    .values({
      email: `integration-${randomUUID()}@integration.test`,
      passwordHash: "integration-test-not-a-real-hash",
    })
    .returning({ id: users.id });

  if (!created) throw new Error("failed to provision integration test user");

  try {
    await body(created.id);
  } finally {
    await db.delete(users).where(eq(users.id, created.id));
  }
}

describeIntegration("corporate actions router (Postgres integration)", () => {
  beforeAll(async () => {
    await db.execute(sql`SELECT 1 FROM corporate_actions LIMIT 1`);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("scales earlier trades so a post-split sale is covered", async () => {
    await withUser(async (userId) => {
      const { splits, trades } = callers(userId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;
      const base = {
        ticker,
        assetClass: "stock_br" as const,
        currency: "BRL" as const,
        fees: "0",
        usdBrlRate: "5",
      };

      await trades.create({
        ...base,
        side: "buy",
        quantity: "100",
        price: "40",
        tradedAt: "2025-01-10",
      });

      const sale = {
        ...base,
        side: "sell" as const,
        quantity: "150",
        price: "22",
        tradedAt: "2025-04-01",
      };

      await expect(trades.create(sale)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      const split = await splits.createSplit({
        ticker,
        effectiveAt: "2025-03-01",
        fromQuantity: "1",
        toQuantity: "2",
      });
      await trades.create(sale);

      const ledger = await trades.forTicker({ ticker });
      expect(ledger).toMatchObject({
        quantity: "50.00000000",
        investedCost: "1000.00",
      });

      // Removing the split would leave the 150-unit sale uncovered.
      await expect(splits.removeSplit({ id: split.id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(
        splits.createSplit({
          ticker,
          effectiveAt: "2025-03-01",
          fromQuantity: "1",
          toQuantity: "3",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("refuses a split with no holding before it and stays account-scoped", async () => {
    await withUser(async (ownerId) => {
      const owner = callers(ownerId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;

      await expect(
        owner.splits.createSplit({
          ticker,
          effectiveAt: "2025-03-01",
          fromQuantity: "1",
          toQuantity: "2",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      await owner.trades.create({
        ticker,
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10",
        price: "10",
        fees: "0",
        tradedAt: "2025-01-10",
        usdBrlRate: "5",
      });
      const split = await owner.splits.createSplit({
        ticker,
        effectiveAt: "2025-03-01",
        fromQuantity: "1",
        toQuantity: "2",
      });

      await withUser(async (otherId) => {
        const other = callers(otherId);

        expect(await other.splits.list({ ticker })).toEqual([]);
        await expect(
          other.splits.removeSplit({ id: split.id }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      await owner.splits.removeSplit({ id: split.id });
      expect(await owner.splits.list({ ticker })).toEqual([]);
    });
  });
});
