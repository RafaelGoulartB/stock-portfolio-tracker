import type { BackupRecord } from "../lib/data-backup";
import {
  adjustForSplits,
  availableBeforeOversell,
  type ConsolidationInput,
  type SplitEvent,
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
 *     (moving-average, no oversell, no backdated coverage), counted in the
 *     share units the backup's own splits imply;
 *   - a fixed-income "ticker" is a single manual balance, so it may not carry
 *     more than one transaction.
 *
 * `createdAt` is a Date on the decoded record, which is exactly what the
 * chronological ordering in the domain expects.
 */
export function assertBackupTransactionsValid(
  transactions: readonly TransactionData[],
  splits: readonly SplitEvent[] = [],
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

    // Sales after a split are recorded in the new units.
    const available = availableBeforeOversell(
      adjustForSplits(entries, splits),
      ticker,
    );
    if (available !== null) {
      throw new BackupFinancialError(
        `Backup oversells ${ticker}: only ${available} available`,
      );
    }
  }
}

type BrokerNoteData = Extract<BackupRecord, { entity: "brokerNotes" }>["data"];
type BrokerSecurityAliasData = Extract<
  BackupRecord,
  { entity: "brokerSecurityAliases" }
>["data"];

/**
 * Imported notes must stay whole after a restore: every note keeps its own
 * trades, in its currency and on its trade date, and no note, reference or
 * security mapping appears twice.
 */
export function assertBackupBrokerNotesValid(
  notes: readonly BrokerNoteData[],
  transactions: readonly TransactionData[],
  aliases: readonly BrokerSecurityAliasData[],
): void {
  const byRef = new Map<string, BrokerNoteData>();
  const fingerprints = new Set<string>();

  for (const note of notes) {
    if (byRef.has(note.ref)) {
      throw new BackupFinancialError("Backup repeats a broker note reference");
    }
    if (fingerprints.has(note.fingerprint)) {
      throw new BackupFinancialError(
        `Backup repeats the broker note of ${note.tradeDate}`,
      );
    }
    byRef.set(note.ref, note);
    fingerprints.add(note.fingerprint);
  }

  const tradeCounts = new Map<string, number>();

  for (const trade of transactions) {
    if (trade.brokerNoteRef === null) continue;

    const note = byRef.get(trade.brokerNoteRef);
    if (!note) {
      throw new BackupFinancialError(
        `Backup trade of ${trade.ticker} points at a missing broker note`,
      );
    }
    if (note.currency !== trade.currency || note.tradeDate !== trade.tradedAt) {
      throw new BackupFinancialError(
        `Backup trade of ${trade.ticker} does not match its broker note`,
      );
    }
    tradeCounts.set(note.ref, (tradeCounts.get(note.ref) ?? 0) + 1);
  }

  for (const note of notes) {
    if (!tradeCounts.has(note.ref)) {
      throw new BackupFinancialError(
        `Backup broker note of ${note.tradeDate} has no trades`,
      );
    }
  }

  const keys = new Set<string>();

  for (const alias of aliases) {
    if (keys.has(alias.sourceKey)) {
      throw new BackupFinancialError("Backup repeats a security mapping");
    }
    keys.add(alias.sourceKey);
  }
}
