import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { sql as client, db } from "../../db";
import { cashBalances, transactions, users } from "../../db/schema";
import type { Context } from "../context";
import { goalsRouter } from "./goals";

/**
 * Opt-in Postgres integration tests (`RUN_DB_INTEGRATION_TESTS=true`). Each
 * test provisions its own users and deletes only them; the cascade removes
 * their rows.
 */
const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

function callerFor(userId: string) {
  const ctx = {
    user: { id: userId, email: `${userId}@integration.test` },
  } as unknown as Context;

  return goalsRouter.createCaller(ctx);
}

async function withUsers(
  count: number,
  body: (userIds: string[]) => Promise<void>,
): Promise<void> {
  const ids: string[] = [];

  try {
    for (let index = 0; index < count; index += 1) {
      const [created] = await db
        .insert(users)
        .values({
          email: `integration-${randomUUID()}@integration.test`,
          passwordHash: "integration-test-not-a-real-hash",
        })
        .returning({ id: users.id });
      if (!created) throw new Error("failed to provision a test user");
      ids.push(created.id);
    }

    await body(ids);
  } finally {
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  }
}

const goal = {
  currency: "BRL" as const,
  monthlyContribution: "2000",
  targetKind: "income" as const,
  targetAmount: "1000",
  withdrawalRate: "0.04",
  conservativeReturn: "0.02",
  baseReturn: "0.04",
  optimisticReturn: "0.06",
  targetMonth: null,
};

describeIntegration("goals router", () => {
  afterAll(async () => {
    await client.end();
  });

  it("stores one goal per account, upserts it and removes it", async () => {
    await withUsers(2, async ([owner, other]) => {
      const caller = callerFor(owner as string);

      expect(await caller.get()).toBeNull();

      await caller.save(goal);
      const saved = await caller.save({
        ...goal,
        monthlyContribution: "2500.5",
        targetMonth: "2045-12",
      });

      expect(saved).toMatchObject({
        monthlyContribution: "2500.5",
        targetAmount: "1000",
        withdrawalRate: "0.04",
        targetMonth: "2045-12",
      });
      expect(await callerFor(other as string).get()).toBeNull();

      await callerFor(other as string).remove();
      expect(await caller.get()).not.toBeNull();

      await caller.remove();
      expect(await caller.get()).toBeNull();
    });
  });

  it("projects from today's value and derives contributions", async () => {
    await withUsers(1, async ([owner]) => {
      const userId = owner as string;
      const caller = callerFor(userId);

      // A closed position needs no quote; cash is the whole value today.
      await db.insert(transactions).values([
        {
          userId,
          ticker: "GOAL3",
          assetClass: "stock_br",
          currency: "BRL",
          side: "buy",
          quantity: "10",
          price: "100",
          fees: "0",
          tradedAt: "2026-01-10",
        },
        {
          userId,
          ticker: "GOAL3",
          assetClass: "stock_br",
          currency: "BRL",
          side: "sell",
          quantity: "10",
          price: "120",
          fees: "0",
          tradedAt: "2026-02-10",
        },
      ]);
      await db.insert(cashBalances).values({ userId, amount: "150000" });

      const empty = await caller.overview({ displayCurrency: "BRL" });

      expect(empty.projection).toBeNull();
      expect(empty.currentValue).toBe("150000.00");
      expect(empty.contributions.months.slice(0, 2)).toEqual([
        { key: "2026-01", amount: "1000.00" },
        { key: "2026-02", amount: "-1200.00" },
      ]);

      await caller.save(goal);
      const overview = await caller.overview({ displayCurrency: "BRL" });

      // R$ 1,000 a month at 4% a year needs R$ 300,000.
      expect(overview.projection).toMatchObject({
        targetValue: "300000.00",
        sustainableMonthlyIncome: "500.00",
        progress: "0.500000",
      });
      expect(overview.plannedMonthlyContribution).toBe("2000.00");
    });
  });
});
