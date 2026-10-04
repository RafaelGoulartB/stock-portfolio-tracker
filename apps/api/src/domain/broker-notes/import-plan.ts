import {
  type AssetClass,
  BROKER_NOTE_ASSET_CLASSES,
  type BrokerNoteIssue,
  type BrokerNoteLine,
  type BrokerNotePreview,
  type BrokerNotePreviewNote,
  type BrokerNoteStatus,
  type Currency,
} from "@portifolio-tracker/shared";
import {
  add,
  type Decimal,
  formatDecimal,
  sub,
  toDecimal,
  ZERO,
} from "../../lib/decimal";
import {
  adjustForSplits,
  type ConsolidationInput,
  effectiveQuantity,
  type SplitEvent,
  tickerCurrencies,
  tradeCashTotal,
} from "../positions";
import { bookNote, noteFingerprint } from "./booking";
import type { ParsedBrokerNote } from "./types";

type BrokerNoteAssetClass = (typeof BROKER_NOTE_ASSET_CLASSES)[number];

/** One readable document of the upload. */
export type PlanDocument = {
  fileName: string;
  sha256: string;
  notes: ParsedBrokerNote[];
};

/** A committed trade of an affected ticker. */
export type PlanLedgerEntry = ConsolidationInput & {
  /** Entered by hand (or booked), as opposed to imported from a note. */
  manual: boolean;
};

export type PlanContext = {
  documents: readonly PlanDocument[];
  history: readonly PlanLedgerEntry[];
  splits: readonly SplitEvent[];
  importedFingerprints: ReadonlySet<string>;
  /** Security mappings saved by earlier imports. */
  savedAliases: ReadonlyMap<string, string>;
  /** Mappings sent with this request; they override saved ones. */
  mappings: ReadonlyMap<string, string>;
  /** Class chosen for tickers without trades. */
  classChoices: ReadonlyMap<string, AssetClass>;
  /** Classes of allocation (watch-only) assets. */
  allocationClasses: ReadonlyMap<string, AssetClass>;
  /** Notes to import; `null` plans every candidate (preview). */
  selected: ReadonlySet<string> | null;
  /** Insertion time of the first imported trade. */
  now: Date;
};

/** A transaction row the import will insert. */
export type TransactionDraft = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  fees: string;
  tradedAt: string;
  createdAt: Date;
};

export type PlannedNote = {
  fingerprint: string;
  fileName: string;
  sha256: string;
  note: ParsedBrokerNote;
  lines: BrokerNoteLine[];
  status: BrokerNoteStatus;
  issues: BrokerNoteIssue[];
  /** Ticker per line, `null` while unmapped. */
  tickers: (string | null)[];
  drafts: TransactionDraft[];
};

export type ImportPlan = {
  notes: PlannedNote[];
  /** Asset class each traded ticker is booked as. */
  assetClasses: ReadonlyMap<string, AssetClass>;
  securities: BrokerNotePreview["securities"];
  newTickers: BrokerNotePreview["newTickers"];
};

function issue(
  code: BrokerNoteIssue["code"],
  fields: Partial<Omit<BrokerNoteIssue, "code">> = {},
): BrokerNoteIssue {
  return {
    code,
    ticker: fields.ticker ?? null,
    available: fields.available ?? null,
    description: fields.description ?? null,
  };
}

function isNoteClass(value: AssetClass): value is BrokerNoteAssetClass {
  return (BROKER_NOTE_ASSET_CLASSES as readonly AssetClass[]).includes(value);
}

/** Chronological order; insertion time breaks ties inside one day. */
function byTradeOrder(a: ConsolidationInput, b: ConsolidationInput): number {
  if (a.tradedAt !== b.tradedAt) return a.tradedAt < b.tradedAt ? -1 : 1;

  return a.createdAt.getTime() - b.createdAt.getTime();
}

type Tagged = ConsolidationInput & { fingerprint: string | null };

/** The first sell of `ticker` that exceeds the quantity held before it. */
function firstOversell(
  entries: readonly Tagged[],
  ticker: string,
): { entry: Tagged; available: Decimal } | null {
  let held = ZERO;

  for (const entry of [...entries].sort(byTradeOrder)) {
    if (entry.ticker !== ticker) continue;

    const quantity = effectiveQuantity(entry);

    if (entry.side === "sell") {
      if (quantity > held) return { entry, available: held };
      held = sub(held, quantity);
    } else {
      held = add(held, quantity);
    }
  }

  return null;
}

function formatQuantity(value: Decimal): string {
  const text = formatDecimal(value);

  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * Decides, without writing anything, what importing the documents would do:
 * which notes are new, which tickers they trade, the rows to insert, and
 * every reason a note cannot be imported. The same plan backs the preview
 * (all candidates) and the import (the selected notes, under ticker locks).
 */
export function planBrokerNoteImport(context: PlanContext): ImportPlan {
  const seen = new Set<string>();
  const planned: PlannedNote[] = [];

  for (const document of context.documents) {
    for (const note of document.notes) {
      const fingerprint = noteFingerprint(note);
      const lines = bookNote(note);
      let status: BrokerNoteStatus = "ready";

      if (context.importedFingerprints.has(fingerprint)) status = "imported";
      else if (seen.has(fingerprint)) status = "duplicate";
      seen.add(fingerprint);

      planned.push({
        fingerprint,
        fileName: document.fileName,
        sha256: document.sha256,
        note,
        lines,
        status,
        issues: [],
        tickers: lines.map(
          (line) =>
            line.documentTicker ??
            context.mappings.get(line.sourceKey) ??
            context.savedAliases.get(line.sourceKey) ??
            null,
        ),
        drafts: [],
      });
    }
  }

  const candidates = planned.filter((note) => note.status === "ready");
  const active = candidates.filter(
    (note) =>
      context.selected === null || context.selected.has(note.fingerprint),
  );

  // Securities printed without a ticker, in first-seen order.
  const securities = new Map<string, BrokerNotePreview["securities"][number]>();
  for (const note of candidates) {
    note.lines.forEach((line, index) => {
      if (line.documentTicker !== null || securities.has(line.sourceKey))
        return;

      const ticker = note.tickers[index] ?? null;

      securities.set(line.sourceKey, {
        sourceKey: line.sourceKey,
        description: line.description,
        ticker,
        saved:
          ticker !== null &&
          !context.mappings.has(line.sourceKey) &&
          context.savedAliases.get(line.sourceKey) === ticker,
      });
    });
  }

  // Class of each ticker: its ledger, then allocation, then the user's choice.
  const historyByTicker = new Map<string, PlanLedgerEntry[]>();
  for (const entry of [...context.history].sort(byTradeOrder)) {
    const list = historyByTicker.get(entry.ticker) ?? [];
    list.push(entry);
    historyByTicker.set(entry.ticker, list);
  }

  const newTickers = new Map<string, BrokerNotePreview["newTickers"][number]>();
  const classOf = new Map<string, AssetClass>();
  for (const note of candidates) {
    note.tickers.forEach((ticker, index) => {
      if (!ticker || classOf.has(ticker)) return;

      const ledgerClass = historyByTicker.get(ticker)?.[0]?.assetClass;
      if (ledgerClass) {
        classOf.set(ticker, ledgerClass);
        return;
      }

      const trade = note.note.trades[index];
      const allocationClass = context.allocationClasses.get(ticker);
      const suggested =
        allocationClass && isNoteClass(allocationClass)
          ? allocationClass
          : (trade?.classHint ?? "other");
      const suggestedClass = isNoteClass(suggested) ? suggested : "other";
      const chosen = context.classChoices.get(ticker);
      const assetClass =
        chosen && isNoteClass(chosen) ? chosen : suggestedClass;

      classOf.set(ticker, assetClass);
      newTickers.set(ticker, {
        ticker,
        currency: note.note.currency,
        suggestedClass,
        assetClass,
      });
    });
  }

  // Static issues: unmapped securities, mixed currencies, fixed income.
  const batchCurrencies = new Map<string, Set<Currency>>();
  for (const note of active) {
    for (const ticker of note.tickers) {
      if (!ticker) continue;
      const set = batchCurrencies.get(ticker) ?? new Set<Currency>();
      set.add(note.note.currency);
      batchCurrencies.set(ticker, set);
    }
  }

  for (const note of candidates) {
    const reported = new Set<string>();
    const report = (value: BrokerNoteIssue) => {
      const key = `${value.code}:${value.ticker ?? value.description}`;
      if (reported.has(key)) return;
      reported.add(key);
      note.issues.push(value);
    };

    note.lines.forEach((line, index) => {
      const ticker = note.tickers[index];

      if (!ticker) {
        report(issue("unmapped_security", { description: line.description }));
        return;
      }

      const history = historyByTicker.get(ticker) ?? [];
      const used = tickerCurrencies(history, ticker);
      const inBatch = batchCurrencies.get(ticker);

      if (
        (used.length > 0 && !used.includes(note.note.currency)) ||
        (inBatch !== undefined && inBatch.size > 1)
      ) {
        report(issue("currency_conflict", { ticker }));
      }

      if (history.some((entry) => entry.assetClass === "fixed_income")) {
        report(issue("fixed_income_conflict", { ticker }));
      }
    });
  }

  // Trade rows in import order: trade date, then upload and document order.
  const ordered = [...active].sort((a, b) =>
    a.note.tradeDate.localeCompare(b.note.tradeDate),
  );
  let sequence = 0;
  for (const note of ordered) {
    note.drafts = note.lines.map((line, index) => {
      sequence += 1;

      return {
        ticker: note.tickers[index] ?? "",
        assetClass: classOf.get(note.tickers[index] ?? "") ?? "other",
        currency: note.note.currency,
        side: line.side,
        quantity: line.quantity,
        price: line.price,
        fees: line.fees,
        tradedAt: note.note.tradeDate,
        createdAt: new Date(context.now.getTime() + sequence),
      };
    });
  }

  // Replays every affected ledger with the importable notes until no sale
  // is left uncovered; a note that oversells is blocked and the rest replay.
  const history: Tagged[] = context.history.map((entry) => ({
    ...entry,
    fingerprint: null,
  }));
  for (;;) {
    const importable = ordered.filter((note) => note.issues.length === 0);
    const entries = adjustForSplits(
      [
        ...history,
        ...importable.flatMap((note) =>
          note.drafts.map((draft) => ({
            ...draft,
            fingerprint: note.fingerprint,
          })),
        ),
      ],
      context.splits,
    );
    const tickers = new Set(
      importable.flatMap((note) => note.drafts.map((draft) => draft.ticker)),
    );
    let blocked = false;

    for (const ticker of tickers) {
      const oversell = firstOversell(entries, ticker);
      if (!oversell) continue;

      const available = formatQuantity(oversell.available);
      const culprits = oversell.entry.fingerprint
        ? importable.filter(
            (note) => note.fingerprint === oversell.entry.fingerprint,
          )
        : // An existing sale lost its cover: blame every note selling it.
          importable.filter((note) =>
            note.drafts.some(
              (draft) => draft.ticker === ticker && draft.side === "sell",
            ),
          );

      for (const note of culprits) {
        note.issues.push(issue("oversell", { ticker, available }));
        blocked = true;
      }
    }

    if (!blocked) break;
  }

  for (const note of candidates) {
    if (note.issues.length > 0) note.status = "blocked";
  }

  return {
    notes: planned,
    assetClasses: classOf,
    securities: [...securities.values()],
    newTickers: [...newTickers.values()],
  };
}

/** The preview shape of a planned note. */
export function previewNote(
  planned: PlannedNote,
  plan: ImportPlan,
  history: readonly PlanLedgerEntry[],
): BrokerNotePreviewNote {
  const { note } = planned;

  return {
    format: note.format,
    noteNumber: note.noteNumber,
    tradeDate: note.tradeDate,
    settlementDate: note.settlementDate,
    currency: note.currency,
    purchasesTotal: note.purchasesTotal,
    salesTotal: note.salesTotal,
    feesTotal: note.feesTotal,
    withheldTax: note.withheldTax,
    netAmount: note.netAmount,
    fingerprint: planned.fingerprint,
    fileName: planned.fileName,
    status: planned.status,
    issues: planned.issues,
    fees: note.fees,
    trades: planned.lines.map((line, index) => {
      const ticker = planned.tickers[index] ?? null;

      return {
        ...line,
        ticker,
        assetClass: ticker ? (plan.assetClasses.get(ticker) ?? null) : null,
        total: tradeCashTotal(line),
        possibleDuplicate:
          ticker !== null &&
          history.some(
            (entry) =>
              entry.manual &&
              entry.ticker === ticker &&
              entry.tradedAt === note.tradeDate &&
              entry.side === line.side &&
              toDecimal(entry.quantity) === toDecimal(line.quantity),
          ),
      };
    }),
  };
}
