import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as client, db } from "../../db";
import { users } from "../../db/schema";
import type { Context } from "../context";
import { transactionsRouter } from "./transactions";

/**
 * Opt-in Postgres integration tests for the two transaction flows whose
 * correctness depends on real advisory locks and serializable ledger reads,
 * not just pure-function math:
 *
 *   1. concurrent `create`/`bookHoldings` for the same ticker in conflicting
 *      currencies — exactly one write may win, upholding one-currency-per-ticker;
 *   2. `remove` of a buy that a later sell relied on — the oversell guard must
 *      reject the deletion so committed history can never go negative.
 *
 * These exercise the live database, so they are skipped unless
 * `RUN_DB_INTEGRATION_TESTS=true`. Each test provisions its own user row and
 * operates only on that user's tickers, then deletes just that user (the
 * `on delete cascade` on `transactions`/`allocation_assets` removes its rows).
 * No reset, drop, or truncate is used, so the target database is left exactly
 * as it was found aside from the ephemeral per-test user.
 */
const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

/** A minimal context: the mutations only read `ctx.user.id`. */
function callerFor(userId: string) {
  const ctx = {
    user: { id: userId, email: `${userId}@integration.test` },
  } as unknown as Context;

  return transactionsRouter.createCaller(ctx);
}

/** Isolates one test to its own account and cleans up only that account. */
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
    // Cascades to this user's transactions and allocation assets only.
    await db.delete(users).where(eq(users.id, created.id));
  }
}

describeIntegration("transactions router (Postgres integration)", () => {
  beforeAll(async () => {
    // Fail loudly if the schema is not migrated rather than silently skipping.
    await db.execute(sql`SELECT 1 FROM transactions LIMIT 1`);
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("lets only one of two conflicting-currency writes win for a ticker", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;

      // Fire both writes concurrently: a BRL buy via `create` and a USD
      // opening lot via `bookHoldings`. The advisory lock serializes them, so
      // whichever commits first fixes the ticker's currency and the other must
      // fail the one-currency-per-ticker precondition.
      const results = await Promise.allSettled([
        caller.create({
          ticker,
          assetClass: "stock_br",
          currency: "BRL",
          side: "buy",
          quantity: "10",
          price: "20",
          fees: "0",
          tradedAt: "2026-01-05",
        }),
        caller.bookHoldings({
          holdings: [
            {
              ticker,
              assetClass: "stock_us",
              currency: "USD",
              quantity: "5",
              price: "30",
            },
          ],
          tradedAt: "2026-01-05",
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const failure = (rejected[0] as PromiseRejectedResult).reason;
      expect(failure).toBeInstanceOf(TRPCError);
      expect((failure as TRPCError).code).toBe("PRECONDITION_FAILED");

      // Exactly one ledger currency survived: the winner's.
      const ledger = await caller.forTicker({ ticker });
      expect(ledger.trades).toHaveLength(1);
      expect(["BRL", "USD"]).toContain(ledger.currency);
      for (const trade of ledger.trades) {
        expect(trade.currency).toBe(ledger.currency);
      }
    });
  });

  it("rejects removing a buy that a later sell depended on", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;

      // Two buys of 10 each, then a sell of 15. Removing either single buy
      // leaves only 10 available against a 15-share sale: an oversell.
      const firstBuy = await caller.create({
        ticker,
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10",
        price: "20",
        fees: "0",
        tradedAt: "2026-01-05",
      });
      await caller.create({
        ticker,
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10",
        price: "22",
        fees: "0",
        tradedAt: "2026-01-06",
      });
      await caller.create({
        ticker,
        assetClass: "stock_br",
        currency: "BRL",
        side: "sell",
        quantity: "15",
        price: "25",
        fees: "0",
        tradedAt: "2026-01-07",
      });

      await expect(caller.remove({ id: firstBuy.id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      // The rejected delete changed nothing: all three trades remain.
      const ledger = await caller.forTicker({ ticker });
      expect(ledger.trades).toHaveLength(3);
      expect(ledger.quantity).toBe("5.00000000");
    });
  });

  it("allows removing a buy once the covered sell is gone", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;

      const buy = await caller.create({
        ticker,
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10",
        price: "20",
        fees: "0",
        tradedAt: "2026-01-05",
      });
      const sell = await caller.create({
        ticker,
        assetClass: "stock_br",
        currency: "BRL",
        side: "sell",
        quantity: "6",
        price: "25",
        fees: "0",
        tradedAt: "2026-01-07",
      });

      // The buy still backs a live sell, so it cannot be removed yet.
      await expect(caller.remove({ id: buy.id })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      // Remove the sell first, then the buy is free to go.
      await caller.remove({ id: sell.id });
      await expect(caller.remove({ id: buy.id })).resolves.toEqual({
        id: buy.id,
      });

      const ledger = await caller.forTicker({ ticker });
      expect(ledger.trades).toHaveLength(0);
    });
  });
  it("edits a trade in place and replays the ledger it touches", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;
      const base = {
        ticker,
        assetClass: "stock_br" as const,
        currency: "BRL" as const,
        fees: "0",
      };
      const buy = await caller.create({
        ...base,
        side: "buy",
        quantity: "10",
        price: "20",
        tradedAt: "2026-01-05",
      });
      await caller.create({
        ...base,
        side: "sell",
        quantity: "6",
        price: "25",
        tradedAt: "2026-01-07",
      });

      // Shrinking the buy below the later sale must be rejected untouched.
      await expect(
        caller.update({
          id: buy.id,
          trade: {
            ...base,
            side: "buy",
            quantity: "5",
            price: "20",
            tradedAt: "2026-01-05",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // A USD rewrite would mix currencies with the remaining sale.
      await expect(
        caller.update({
          id: buy.id,
          trade: {
            ...base,
            currency: "USD",
            side: "buy",
            quantity: "10",
            price: "20",
            tradedAt: "2026-01-05",
          },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const edited = await caller.update({
        id: buy.id,
        trade: {
          ...base,
          side: "buy",
          quantity: "8",
          price: "21",
          fees: "1",
          tradedAt: "2026-01-04",
          notes: "Corrected broker note",
        },
      });

      expect(edited).toMatchObject({
        id: buy.id,
        quantity: "8.00000000",
        tradedAt: "2026-01-04",
        notes: "Corrected broker note",
      });

      const ledger = await caller.forTicker({ ticker });
      expect(ledger.trades).toHaveLength(2);
      expect(ledger.quantity).toBe("2.00000000");
    });
  });

  it("never edits another account's trade", async () => {
    await withUser(async (ownerId) => {
      const owner = callerFor(ownerId);
      const ticker = `INTG${randomUUID().slice(0, 8).toUpperCase()}`;
      const trade = {
        ticker,
        assetClass: "stock_br" as const,
        currency: "BRL" as const,
        side: "buy" as const,
        quantity: "10",
        price: "20",
        fees: "0",
        tradedAt: "2026-01-05",
      };
      const created = await owner.create(trade);

      await withUser(async (otherId) => {
        await expect(
          callerFor(otherId).update({
            id: created.id,
            trade: { ...trade, quantity: "1" },
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });

      const ledger = await owner.forTicker({ ticker });
      expect(ledger.quantity).toBe("10.00000000");
    });
  });

  it("filters the history by a ticker substring within the account", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const suffix = randomUUID().slice(0, 6).toUpperCase();
      const trade = {
        assetClass: "stock_br" as const,
        currency: "BRL" as const,
        side: "buy" as const,
        quantity: "1",
        price: "10",
        fees: "0",
        tradedAt: "2026-01-05",
      };

      await caller.create({ ...trade, ticker: `AAA${suffix}` });
      await caller.create({ ...trade, ticker: `BBB${suffix}` });

      const filtered = await caller.list({ ticker: `aaa${suffix}` });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.ticker).toBe(`AAA${suffix}`);

      // A literal wildcard must not match every row.
      const wildcard = await caller.list({ ticker: "%" });
      expect(wildcard.total).toBe(0);
    });
  });

  it("filters the history by side and class and counts both sides", async () => {
    await withUser(async (userId) => {
      const caller = callerFor(userId);
      const trade = {
        currency: "BRL" as const,
        quantity: "2",
        price: "10",
        fees: "0",
      };

      await caller.create({
        ...trade,
        ticker: "PETR4",
        assetClass: "stock_br",
        side: "buy",
        tradedAt: "2026-01-05",
      });
      await caller.create({
        ...trade,
        ticker: "PETR4",
        assetClass: "stock_br",
        side: "sell",
        quantity: "1",
        tradedAt: "2026-01-06",
      });
      await caller.create({
        ...trade,
        ticker: "HGLG11",
        assetClass: "reit",
        side: "buy",
        tradedAt: "2026-01-07",
      });

      const all = await caller.list({});
      expect(all.total).toBe(3);
      expect(all.sides).toEqual({ buy: 2, sell: 1 });

      const sells = await caller.list({ side: "sell" });
      expect(sells.items.map((item) => item.side)).toEqual(["sell"]);
      expect(sells.sides).toEqual({ buy: 0, sell: 1 });

      const reits = await caller.list({ assetClass: "reit" });
      expect(reits.items.map((item) => item.ticker)).toEqual(["HGLG11"]);
    });
  });
});
