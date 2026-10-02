import { randomUUID } from "node:crypto";
import type { ParsedBrokerNote } from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { sql as client, db } from "../../db";
import { brokerNotes, transactions, users } from "../../db/schema";
import { signPayload } from "../../lib/signed-payload";
import type { Context } from "../context";
import { brokerNotesRouter, signatureScope } from "./broker-notes";
import { transactionsRouter } from "./transactions";

/**
 * Opt-in Postgres integration tests for the rules that keep imported trades
 * tied to their note: an imported trade cannot be edited or deleted alone,
 * and deleting the note is refused while a later sale depends on its buys.
 * Skipped unless `RUN_DB_INTEGRATION_TESTS=true`; each test provisions and
 * then deletes its own user, which cascades to its rows only.
 */
const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeIntegration = runIntegration ? describe : describe.skip;

function callers(userId: string) {
  const ctx = {
    user: { id: userId, email: `${userId}@integration.test` },
  } as unknown as Context;

  return {
    notes: brokerNotesRouter.createCaller(ctx),
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

/** A stored note with one imported buy of 10 VALE3. */
async function seedNote(userId: string) {
  const [note] = await db
    .insert(brokerNotes)
    .values({
      userId,
      format: "inter-dtvm-sinacor",
      fingerprint: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      fileName: "nota.pdf",
      fileSha256: "0".repeat(64),
      tradeDate: "2026-01-05",
      settlementDate: "2026-01-07",
      currency: "BRL",
      purchasesTotal: "600",
      salesTotal: "0",
      feesTotal: "0.18",
      withheldTax: "0",
      netAmount: "-600.18",
      details: { version: 1, fees: [], withheldTaxBase: null, lines: [] },
    })
    .returning({ id: brokerNotes.id });

  if (!note) throw new Error("failed to seed note");

  const [trade] = await db
    .insert(transactions)
    .values({
      userId,
      ticker: "VALE3",
      assetClass: "stock_br",
      currency: "BRL",
      side: "buy",
      quantity: "10",
      price: "60",
      fees: "0.18",
      tradedAt: "2026-01-05",
      brokerNoteId: note.id,
    })
    .returning({ id: transactions.id });

  if (!trade) throw new Error("failed to seed trade");

  return { noteId: note.id, tradeId: trade.id };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

describeIntegration("broker notes (Postgres integration)", () => {
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("keeps imported trades immutable outside their note", async () => {
    await withUser(async (userId) => {
      const { notes, trades } = callers(userId);
      const { noteId, tradeId } = await seedNote(userId);

      expect(await codeOf(trades.remove({ id: tradeId }))).toBe(
        "UNPROCESSABLE_CONTENT",
      );
      expect(
        await codeOf(
          trades.update({
            id: tradeId,
            trade: {
              ticker: "VALE3",
              assetClass: "stock_br",
              side: "buy",
              quantity: "11",
              price: "60",
              tradedAt: "2026-01-05",
            },
          }),
        ),
      ).toBe("UNPROCESSABLE_CONTENT");

      const list = await trades.list({ page: 0, pageSize: 10 });
      expect(list.items[0]?.brokerNote).toEqual({
        id: noteId,
        format: "inter-dtvm-sinacor",
        noteNumber: null,
      });
      expect((await notes.list({ page: 0, pageSize: 10 })).items).toEqual([
        expect.objectContaining({ id: noteId, tradeCount: 1 }),
      ]);
    });
  });

  it("refuses to delete a note whose buys cover a later sale", async () => {
    await withUser(async (userId) => {
      const { notes, trades } = callers(userId);
      const { noteId } = await seedNote(userId);
      const sale = await trades.create({
        ticker: "VALE3",
        assetClass: "stock_br",
        currency: "BRL",
        side: "sell",
        quantity: "6",
        price: "70",
        tradedAt: "2026-02-01",
        usdBrlRate: "5",
      });

      expect(await codeOf(notes.remove({ id: noteId }))).toBe("BAD_REQUEST");

      await trades.remove({ id: sale.id });
      expect(await notes.remove({ id: noteId })).toEqual({
        id: noteId,
        transactions: 1,
      });
      expect((await trades.list({ page: 0, pageSize: 10 })).total).toBe(0);
    });
  });

  /** A B3 note with one 10 × 60,00 buy of a printed ticker. */
  function parsedNote(): ParsedBrokerNote {
    return {
      format: "inter-dtvm-web",
      currency: "BRL",
      noteNumber: "123",
      account: null,
      tradeDate: "2026-01-05",
      settlementDate: "2026-01-07",
      trades: [
        {
          side: "buy",
          sourceKey: "B3:VALE3",
          description: "VALE3 ON",
          ticker: "VALE3",
          classHint: "stock_br",
          quantity: "10",
          executionPrice: "60.00",
          grossValue: "600.00",
          netValue: null,
          market: "VIS",
          flags: [],
          settlementDate: "2026-01-07",
          references: {},
        },
      ],
      fees: [{ label: "Taxa de liquidação", amount: "0.15" }],
      purchasesTotal: "600.00",
      salesTotal: "0.00",
      feesTotal: "0.15",
      withheldTax: "0.00",
      dayTradeWithheldTax: "0.00",
      withheldTaxBase: null,
      netAmount: "-600.15",
    };
  }

  function signedDocument(userId: string, note = parsedNote()) {
    const content = {
      fileName: "nota.pdf",
      sha256: "1".repeat(64),
      notes: [note],
    };

    return {
      ...content,
      signature: signPayload(signatureScope(userId), content),
    };
  }

  it("imports signed notes and refuses altered or foreign ones", async () => {
    await withUser(async (userId) => {
      const { notes, trades } = callers(userId);
      const document = signedDocument(userId);
      const preview = await notes.preview({ documents: [document] });

      expect(preview.notes.map((note) => note.status)).toEqual(["ready"]);

      const altered = {
        ...document,
        notes: [{ ...parsedNote(), purchasesTotal: "60.00" }],
      };
      expect(await codeOf(notes.preview({ documents: [altered] }))).toBe(
        "UNPROCESSABLE_CONTENT",
      );
      expect(
        await codeOf(
          notes.preview({ documents: [signedDocument(randomUUID())] }),
        ),
      ).toBe("UNPROCESSABLE_CONTENT");

      const fingerprint = preview.notes[0]?.fingerprint as string;
      expect(
        await notes.import({
          documents: [document],
          fingerprints: [fingerprint],
        }),
      ).toEqual({ notes: 1, transactions: 1 });

      const [trade] = (await trades.list({ page: 0, pageSize: 10 })).items;
      expect(trade).toMatchObject({
        ticker: "VALE3",
        quantity: "10.00000000",
        price: "60.00000000",
        fees: "0.15000000",
        total: "600.15",
      });
    });
  });
});
