import { describe, expect, it } from "vitest";
import type { BackupRecord } from "../lib/data-backup";
import {
  assertBackupBrokerNotesValid,
  assertBackupTransactionsValid,
  BackupFinancialError,
} from "./backup-validation";

type TransactionData = Extract<
  BackupRecord,
  { entity: "transactions" }
>["data"];

let sequence = 0;

function tx(partial: Partial<TransactionData> = {}): TransactionData {
  sequence += 1;
  return {
    ticker: "PETR4",
    assetClass: "stock_br",
    currency: "BRL",
    side: "buy",
    quantity: "10",
    price: "25",
    fees: "0",
    tradedAt: "2026-01-01",
    usdBrlRate: null,
    notes: null,
    brokerNoteRef: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    ...partial,
  };
}

describe("assertBackupTransactionsValid", () => {
  it("accepts a well-formed ledger", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ side: "buy", quantity: "10" }),
        tx({ side: "sell", quantity: "4" }),
      ]),
    ).not.toThrow();
  });

  it("rejects a ticker tracked in two currencies", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ currency: "BRL" }),
        tx({ currency: "USD" }),
      ]),
    ).toThrow(BackupFinancialError);
  });

  it("rejects a sell that exceeds the quantity held at that point", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ side: "buy", quantity: "5", tradedAt: "2026-01-01" }),
        tx({ side: "sell", quantity: "6", tradedAt: "2026-01-02" }),
      ]),
    ).toThrow(/oversells/i);
  });

  it("counts sales in the units the backup's own splits imply", () => {
    const ledger = [
      tx({ side: "buy", quantity: "10", tradedAt: "2026-01-01" }),
      tx({ side: "sell", quantity: "15", tradedAt: "2026-03-01" }),
    ];

    expect(() => assertBackupTransactionsValid(ledger)).toThrow(/oversells/i);
    expect(() =>
      assertBackupTransactionsValid(ledger, [
        {
          ticker: "PETR4",
          effectiveAt: "2026-02-01",
          fromQuantity: "1",
          toQuantity: "2",
        },
      ]),
    ).not.toThrow();
  });

  it("rejects a sell backdated before its covering buy", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ side: "sell", quantity: "5", tradedAt: "2026-01-01" }),
        tx({ side: "buy", quantity: "10", tradedAt: "2026-01-02" }),
      ]),
    ).toThrow(/oversells/i);
  });

  it("rejects more than one fixed-income entry for the same balance", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ ticker: "CDB", assetClass: "fixed_income", quantity: "1" }),
        tx({ ticker: "CDB", assetClass: "fixed_income", quantity: "1" }),
      ]),
    ).toThrow(/fixed-income/i);
  });

  it("accepts a single fixed-income entry", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ ticker: "CDB", assetClass: "fixed_income", quantity: "1" }),
      ]),
    ).not.toThrow();
  });

  it("isolates rules per ticker", () => {
    expect(() =>
      assertBackupTransactionsValid([
        tx({ ticker: "PETR4", side: "buy", quantity: "10" }),
        tx({ ticker: "VALE3", side: "buy", quantity: "5", currency: "BRL" }),
        tx({ ticker: "VALE3", side: "sell", quantity: "5", currency: "BRL" }),
      ]),
    ).not.toThrow();
  });
});

type BrokerNoteData = Extract<BackupRecord, { entity: "brokerNotes" }>["data"];

const NOTE_REF = "4f1f8a5e-7d0c-4f43-9a55-2c6a0e1d9b10";

function note(partial: Partial<BrokerNoteData> = {}): BrokerNoteData {
  return {
    ref: NOTE_REF,
    format: "inter-dtvm-sinacor",
    fingerprint: "a".repeat(64),
    fileName: "note.pdf",
    fileSha256: "b".repeat(64),
    noteNumber: null,
    account: null,
    tradeDate: "2026-01-01",
    settlementDate: "2026-01-05",
    currency: "BRL",
    purchasesTotal: "250.00",
    salesTotal: "0.00",
    feesTotal: "0.07",
    withheldTax: "0.00",
    netAmount: "-250.07",
    details: { version: 1, fees: [], withheldTaxBase: null, lines: [] },
    createdAt: new Date(Date.UTC(2026, 0, 2)),
    ...partial,
  };
}

describe("assertBackupBrokerNotesValid", () => {
  it("accepts a note with its own trades", () => {
    expect(() =>
      assertBackupBrokerNotesValid(
        [note()],
        [tx({ brokerNoteRef: NOTE_REF }), tx()],
        [],
      ),
    ).not.toThrow();
  });

  it("rejects a trade pointing at a missing note", () => {
    expect(() =>
      assertBackupBrokerNotesValid([], [tx({ brokerNoteRef: NOTE_REF })], []),
    ).toThrow(BackupFinancialError);
  });

  it("rejects a trade off its note's date or currency", () => {
    expect(() =>
      assertBackupBrokerNotesValid(
        [note()],
        [tx({ brokerNoteRef: NOTE_REF, tradedAt: "2026-01-02" })],
        [],
      ),
    ).toThrow(/does not match its broker note/);
    expect(() =>
      assertBackupBrokerNotesValid(
        [note({ currency: "USD" })],
        [tx({ brokerNoteRef: NOTE_REF })],
        [],
      ),
    ).toThrow(/does not match its broker note/);
  });

  it("rejects a note without trades and repeated notes or mappings", () => {
    expect(() => assertBackupBrokerNotesValid([note()], [], [])).toThrow(
      /has no trades/,
    );
    expect(() =>
      assertBackupBrokerNotesValid(
        [note(), note({ ref: "5f1f8a5e-7d0c-4f43-9a55-2c6a0e1d9b10" })],
        [tx({ brokerNoteRef: NOTE_REF })],
        [],
      ),
    ).toThrow(/repeats the broker note/);

    const alias = {
      sourceKey: "B3:VALE|ON",
      ticker: "VALE3",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(() => assertBackupBrokerNotesValid([], [], [alias, alias])).toThrow(
      /repeats a security mapping/,
    );
  });
});
