import { describe, expect, it } from "vitest";
import type { BackupRecord } from "../lib/data-backup";
import {
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
    notes: null,
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
