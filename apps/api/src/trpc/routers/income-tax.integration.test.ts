import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { sql as client, db } from "../../db";
import { brokerNotes, transactions, users } from "../../db/schema";
import type { Context } from "../context";
import { corporateActionsRouter } from "./corporate-actions";
import { incomeTaxRouter } from "./income-tax";

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

  return incomeTaxRouter.createCaller(ctx);
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

describeIntegration("incomeTax router", () => {
  afterAll(async () => {
    await client.end();
  });

  it("stores opening balances per account and upserts them", async () => {
    await withUsers(2, async ([owner, other]) => {
      const caller = callerFor(owner as string);

      expect(await caller.settings()).toMatchObject({ configured: false });

      await caller.saveSettings({
        startYear: 2026,
        ordinaryLoss: "4571.99",
        dayTradeLoss: "0",
        fiiLoss: "2287.57",
        foreignLoss: "0",
        pendingDarf: "0",
      });
      const saved = await caller.saveSettings({
        startYear: 2026,
        ordinaryLoss: "4571.99",
        dayTradeLoss: "0",
        fiiLoss: "2287.57",
        foreignLoss: "12.5",
        pendingDarf: "3",
      });

      expect(saved).toEqual({
        startYear: 2026,
        ordinaryLoss: "4571.99",
        dayTradeLoss: "0.00",
        fiiLoss: "2287.57",
        foreignLoss: "12.50",
        pendingDarf: "3.00",
        configured: true,
      });
      expect(await callerFor(other as string).settings()).toMatchObject({
        configured: false,
        ordinaryLoss: "0",
      });
    });
  });

  it("assesses the account's own trades and note IRRF only", async () => {
    await withUsers(2, async ([owner, other]) => {
      const [note] = await db
        .insert(brokerNotes)
        .values({
          userId: owner as string,
          format: "inter-dtvm-web",
          fingerprint: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          fileName: "nota.pdf",
          fileSha256: "c".repeat(64),
          tradeDate: "2026-03-20",
          currency: "BRL",
          purchasesTotal: "0",
          salesTotal: "31000",
          feesTotal: "0",
          withheldTax: "1.55",
          dayTradeWithheldTax: "0",
          netAmount: "31000",
          details: { version: 1, fees: [], withheldTaxBase: null, lines: [] },
        })
        .returning({ id: brokerNotes.id });

      await db.insert(transactions).values([
        {
          userId: owner as string,
          ticker: "VALE3",
          side: "buy",
          quantity: "1000",
          price: "30",
          tradedAt: "2026-01-05",
        },
        {
          userId: owner as string,
          ticker: "VALE3",
          side: "sell",
          quantity: "1000",
          price: "31",
          tradedAt: "2026-03-20",
          brokerNoteId: note?.id,
        },
        {
          userId: other as string,
          ticker: "VALE3",
          side: "buy",
          quantity: "5",
          price: "10",
          tradedAt: "2026-01-05",
        },
      ]);

      await callerFor(owner as string).saveSettings({
        startYear: 2026,
        ordinaryLoss: "100",
        dayTradeLoss: "0",
        fiiLoss: "0",
        foreignLoss: "0",
        pendingDarf: "0",
      });

      const report = await callerFor(owner as string).report({ year: 2026 });
      const march = report.months.find((month) => month.month === "2026-03");

      expect(march).toMatchObject({
        ordinaryResult: "1000.00",
        ordinaryBase: "900.00",
        ordinaryTax: "135.00",
        withheld: "1.55",
        darf: "133.45",
      });
      expect(report.holdings).toEqual([]);

      const otherReport = await callerFor(other as string).report({
        year: 2026,
      });
      expect(otherReport.months.every((month) => month.sales === 0)).toBe(true);
      expect(otherReport.holdings).toEqual([
        expect.objectContaining({ ticker: "VALE3", quantity: "5.00000000" }),
      ]);
    });
  });

  it("records a bonus as a units ratio and adds its cost to the tax ledger", async () => {
    await withUsers(1, async ([owner]) => {
      const ctx = {
        user: { id: owner as string, email: "owner@integration.test" },
      } as unknown as Context;

      await db.insert(transactions).values([
        {
          userId: owner as string,
          ticker: "ITUB3",
          side: "buy",
          quantity: "298",
          price: "30",
          tradedAt: "2025-12-31",
        },
        {
          userId: owner as string,
          ticker: "ITUB3",
          side: "buy",
          quantity: "2",
          price: "30",
          tradedAt: "2026-03-20",
        },
      ]);

      const bonus = await corporateActionsRouter.createCaller(ctx).createBonus({
        ticker: "ITUB3",
        effectiveAt: "2026-03-20",
        receivedQuantity: "29",
        unitCost: "18",
      });

      // The buy on the ex-date itself does not receive bonus shares.
      expect(bonus).toMatchObject({
        kind: "bonus",
        fromQuantity: "298.00000000",
        toQuantity: "327.00000000",
        unitCost: "18.00000000",
      });

      const report = await callerFor(owner as string).report({ year: 2026 });
      expect(report.bonuses).toEqual([
        expect.objectContaining({ quantity: "29.00000000", value: "522.00" }),
      ]);
      expect(report.holdings[0]).toMatchObject({
        quantity: "329.00000000",
        cost: "9522.00",
      });
    });
  });

  it("keeps payments, tax details and foreign cash per account", async () => {
    await withUsers(2, async ([owner, other]) => {
      const caller = callerFor(owner as string);

      await caller.recordDarfPayment({
        month: "2026-03",
        paidOn: "2026-04-29",
        amount: "147.95",
      });
      await caller.recordDarfPayment({
        month: "2026-03",
        paidOn: "2026-04-30",
        amount: "150",
      });
      await caller.saveAssetProfile({
        ticker: "TTEN3",
        legalName: "TRÊS TENTOS AGROINDUSTRIAL S/A",
        cnpj: "94813102000170",
      });
      await expect(
        caller.saveAssetProfile({ ticker: "TTEN3", cnpj: "94813102000171" }),
      ).rejects.toThrow();
      await caller.saveForeignCash({
        year: 2025,
        amountUsd: "12.34",
        valueBrl: "67.89",
        institution: "Inter&Co",
      });
      await db.insert(transactions).values({
        userId: owner as string,
        ticker: "TTEN3",
        side: "buy",
        quantity: "10",
        price: "13",
        tradedAt: "2025-12-31",
      });

      const report = await caller.report({ year: 2026 });
      expect(
        report.months.find((month) => month.month === "2026-03"),
      ).toMatchObject({ darfPaid: "150.00", darfPaidOn: "2026-04-30" });
      expect(report.holdings[0]).toMatchObject({
        ticker: "TTEN3",
        cnpj: "94.813.102/0001-70",
        legalName: "TRÊS TENTOS AGROINDUSTRIAL S/A",
      });
      expect(report.foreignCash.before).toEqual({
        year: 2025,
        amountUsd: "12.34",
        valueBrl: "67.89",
        institution: "Inter&Co",
      });

      const otherReport = await callerFor(other as string).report({
        year: 2026,
      });
      expect(otherReport.totals.darfPaid).toBe("0.00");
      expect(otherReport.foreignCash.before).toBeNull();

      await caller.removeDarfPayment({ month: "2026-03" });
      await caller.saveAssetProfile({ ticker: "TTEN3" });
      await caller.removeForeignCash({ year: 2025 });
      const cleared = await caller.report({ year: 2026 });
      expect(cleared.totals.darfPaid).toBe("0.00");
      expect(cleared.holdings[0]?.cnpj).toBeNull();
      expect(cleared.foreignCash.before).toBeNull();
    });
  });
});
