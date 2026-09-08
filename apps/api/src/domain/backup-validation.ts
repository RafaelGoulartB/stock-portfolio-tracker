import type { BackupRecord } from "../lib/data-backup";
import {
  availableBeforeOversell,
  type ConsolidationInput,
  tickerCurrencies,
} from "./positions";

/** A transaction record's payload as it arrives from a decoded backup line. */
type TransactionData = Extract<
  BackupRecord,
  { entity: "transactions" }
>["data"];

/**
 * Thrown when a decoded backup would violate a financial invariant. The
 * importer converts this into a rejected request; the message is safe to
 * surface because it only describes the offending ticker, never account data.
 */
export class BackupFinancialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFinancialError";
  }
}

/**
 * Re-checks the transaction ledger of an incoming backup against the same
 * financial rules the transactions router enforces on every write. A backup
 * is untrusted input: it may have been hand-edited or produced by an older,
 * looser build, so replaying it must never smuggle in a state the live app
 * would refuse to create.
 *
 * The rules mirror `transactionsRouter.create`:
 *   - one ticker is tracked in exactly one native currency;
 *   - a sell can never exceed the quantity held at that point in the ledger
 *     (moving-average, no oversell, no backdated coverage);
 *   - a fixed-income "ticker" is a single manual balance, so it may not carry
 *     more than one transaction.
 *
 * `createdAt` is a Date on the decoded record, which is exactly what the
 * chronological ordering in the domain expects.
 */
export function assertBackupTransactionsValid(
  transactions: readonly TransactionData[],
): void {
  const byTicker = new Map<string, ConsolidationInput[]>();

  for (const record of transactions) {
    const entry: ConsolidationInput = {
      ticker: record.ticker,
      assetClass: record.assetClass,
      currency: record.currency,
      side: record.side,
      quantity: record.quantity,
      price: record.price,
      fees: record.fees,
      tradedAt: record.tradedAt,
      createdAt: record.createdAt,
    };
    const bucket = byTicker.get(record.ticker);
    if (bucket) {
      bucket.push(entry);
    } else {
      byTicker.set(record.ticker, [entry]);
    }
  }

  for (const [ticker, entries] of byTicker) {
    const currencies = tickerCurrencies(entries, ticker);
    if (currencies.length > 1) {
      throw new BackupFinancialError(
        `Backup mixes currencies (${currencies.join(", ")}) for ${ticker}`,
      );
    }

    if (
      entries.some((entry) => entry.assetClass === "fixed_income") &&
      entries.length > 1
    ) {
      throw new BackupFinancialError(
        `Backup has more than one fixed-income entry for ${ticker}`,
      );
    }

    const available = availableBeforeOversell(entries, ticker);
    if (available !== null) {
      throw new BackupFinancialError(
        `Backup oversells ${ticker}: only ${available} available`,
      );
    }
  }
}
