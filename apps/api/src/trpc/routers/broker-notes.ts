import { createHash } from "node:crypto";
import {
  type AssetClass,
  type BrokerNoteDetail,
  type BrokerNoteFileError,
  type BrokerNoteList,
  type BrokerNotePreview,
  brokerNoteIdInput,
  brokerNoteImportInput,
  brokerNoteListInput,
  brokerNotePreviewInput,
  MAX_BROKER_NOTE_FILE_BYTES,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../db";
import {
  allocationAssets,
  brokerNotes,
  brokerSecurityAliases,
  transactions,
} from "../../db/schema";
import { noteFingerprint } from "../../domain/broker-notes/booking";
import {
  type ImportPlan,
  type PlanDocument,
  type PlanLedgerEntry,
  planBrokerNoteImport,
  previewNote,
} from "../../domain/broker-notes/import-plan";
import { parseBrokerNotePages } from "../../domain/broker-notes/parse";
import { BrokerNoteParseError } from "../../domain/broker-notes/types";
import {
  adjustForSplits,
  availableBeforeOversell,
  tradeCashTotal,
} from "../../domain/positions";
import { tradeDateRates } from "../../lib/fx/trade-rates";
import { extractPdfPages, isPdf, PdfReadError } from "../../lib/pdf-text";
import { protectedProcedure, router } from "../trpc";
import { lockTickers, readIdentifiedHistory, readSplits } from "./transactions";

/** A broker note never needs more pages than this; larger files are refused. */
const MAX_PDF_PAGES = 60;

type DbExecutor =
  | Parameters<Parameters<typeof db.transaction>[0]>[0]
  | typeof db;

type PreviewInput = z.output<typeof brokerNotePreviewInput>;

type FileResult = BrokerNotePreview["files"][number];

function fileError(
  fileName: string,
  sha256: string,
  error: BrokerNoteFileError,
  detail: string,
): FileResult {
  return { fileName, sha256, error, errorDetail: detail, noteCount: 0 };
}

/**
 * Decodes and parses every upload. A file that fails is reported and left
 * out; it never contributes a partial note.
 */
async function readDocuments(files: PreviewInput["files"]): Promise<{
  files: FileResult[];
  documents: PlanDocument[];
}> {
  const results: FileResult[] = [];
  const documents: PlanDocument[] = [];

  for (const file of files) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBase64)) {
      results.push(fileError(file.name, "", "not_pdf", "Invalid base64"));
      continue;
    }

    const bytes = new Uint8Array(Buffer.from(file.contentBase64, "base64"));
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (bytes.byteLength > MAX_BROKER_NOTE_FILE_BYTES) {
      results.push(fileError(file.name, sha256, "too_large", "Over 5 MB"));
      continue;
    }
    if (!isPdf(bytes)) {
      results.push(fileError(file.name, sha256, "not_pdf", "Not a PDF"));
      continue;
    }

    try {
      const pages = await extractPdfPages(bytes, { maxPages: MAX_PDF_PAGES });
      const notes = parseBrokerNotePages(pages);

      documents.push({ fileName: file.name, sha256, notes });
      results.push({
        fileName: file.name,
        sha256,
        error: null,
        errorDetail: null,
        noteCount: notes.length,
      });
    } catch (error) {
      if (error instanceof PdfReadError) {
        results.push(fileError(file.name, sha256, error.reason, error.message));
      } else if (error instanceof BrokerNoteParseError) {
        results.push(fileError(file.name, sha256, error.code, error.message));
      } else {
        console.error("Broker note parsing failed", error);
        results.push(
          fileError(
            file.name,
            sha256,
            "unreadable",
            error instanceof Error ? error.message : "Unexpected failure",
          ),
        );
      }
    }
  }

  return { files: results, documents };
}

type LedgerContext = {
  history: PlanLedgerEntry[];
  splits: Awaited<ReturnType<typeof readSplits>>;
  importedFingerprints: Set<string>;
  savedAliases: Map<string, string>;
  allocationClasses: Map<string, AssetClass>;
  tickers: string[];
};

/**
 * Every account fact the plan depends on, read through `executor` so the
 * import can read it under its ticker locks.
 */
async function loadLedgerContext(
  executor: DbExecutor,
  userId: string,
  documents: readonly PlanDocument[],
  mappings: ReadonlyMap<string, string>,
): Promise<LedgerContext> {
  const notes = documents.flatMap((document) => document.notes);
  const trades = notes.flatMap((note) => note.trades);
  const keys = [
    ...new Set(
      trades
        .filter((trade) => trade.ticker === null)
        .map((trade) => trade.sourceKey),
    ),
  ];
  const fingerprints = [...new Set(notes.map(noteFingerprint))];
  const [aliasRows, importedRows] = await Promise.all([
    keys.length === 0
      ? []
      : executor
          .select({
            sourceKey: brokerSecurityAliases.sourceKey,
            ticker: brokerSecurityAliases.ticker,
          })
          .from(brokerSecurityAliases)
          .where(
            and(
              eq(brokerSecurityAliases.userId, userId),
              inArray(brokerSecurityAliases.sourceKey, keys),
            ),
          ),
    fingerprints.length === 0
      ? []
      : executor
          .select({ fingerprint: brokerNotes.fingerprint })
          .from(brokerNotes)
          .where(
            and(
              eq(brokerNotes.userId, userId),
              inArray(brokerNotes.fingerprint, fingerprints),
            ),
          ),
  ]);
  const savedAliases = new Map(
    aliasRows.map((row) => [row.sourceKey, row.ticker]),
  );
  const tickers = [
    ...new Set(
      trades
        .map(
          (trade) =>
            trade.ticker ??
            mappings.get(trade.sourceKey) ??
            savedAliases.get(trade.sourceKey) ??
            null,
        )
        .filter((ticker): ticker is string => ticker !== null),
    ),
  ].sort();

  if (tickers.length === 0) {
    return {
      history: [],
      splits: [],
      importedFingerprints: new Set(importedRows.map((row) => row.fingerprint)),
      savedAliases,
      allocationClasses: new Map(),
      tickers,
    };
  }

  const [historyRows, splits, allocationRows] = await Promise.all([
    executor
      .select({
        ticker: transactions.ticker,
        assetClass: transactions.assetClass,
        currency: transactions.currency,
        side: transactions.side,
        quantity: transactions.quantity,
        price: transactions.price,
        fees: transactions.fees,
        tradedAt: transactions.tradedAt,
        createdAt: transactions.createdAt,
        brokerNoteId: transactions.brokerNoteId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.ticker, tickers),
        ),
      )
      .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt)),
    readSplits(executor, userId, tickers),
    executor
      .select({
        ticker: allocationAssets.ticker,
        assetClass: allocationAssets.assetClass,
      })
      .from(allocationAssets)
      .where(
        and(
          eq(allocationAssets.userId, userId),
          inArray(allocationAssets.ticker, tickers),
        ),
      ),
  ]);

  return {
    history: historyRows.map(({ brokerNoteId, assetClass, ...row }) => {
      // Rows written before the BR/US stock split still read back as `stock`.
      const rawClass: string = assetClass;

      return {
        ...row,
        assetClass: (rawClass === "stock"
          ? "stock_br"
          : assetClass) as AssetClass,
        manual: brokerNoteId === null,
      };
    }),
    splits,
    importedFingerprints: new Set(importedRows.map((row) => row.fingerprint)),
    savedAliases,
    allocationClasses: new Map(
      allocationRows.map((row) => [row.ticker, row.assetClass as AssetClass]),
    ),
    tickers,
  };
}

function planFor(
  input: PreviewInput,
  documents: readonly PlanDocument[],
  ledger: LedgerContext,
  selected: ReadonlySet<string> | null,
): ImportPlan {
  return planBrokerNoteImport({
    documents,
    history: ledger.history,
    splits: ledger.splits,
    importedFingerprints: ledger.importedFingerprints,
    savedAliases: ledger.savedAliases,
    mappings: new Map(input.mappings.map((m) => [m.sourceKey, m.ticker])),
    classChoices: new Map(
      input.assetClasses.map((c) => [c.ticker, c.assetClass]),
    ),
    allocationClasses: ledger.allocationClasses,
    selected,
    now: new Date(),
  });
}

/** Postgres unique-violation SQLSTATE, possibly wrapped by Drizzle. */
function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value
      ? (value as { code?: unknown }).code
      : undefined;

  return (
    code(error) === "23505" ||
    (typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      code((error as { cause?: unknown }).cause) === "23505")
  );
}

const summaryColumns = {
  id: brokerNotes.id,
  format: brokerNotes.format,
  noteNumber: brokerNotes.noteNumber,
  tradeDate: brokerNotes.tradeDate,
  settlementDate: brokerNotes.settlementDate,
  currency: brokerNotes.currency,
  purchasesTotal: brokerNotes.purchasesTotal,
  salesTotal: brokerNotes.salesTotal,
  feesTotal: brokerNotes.feesTotal,
  withheldTax: brokerNotes.withheldTax,
  netAmount: brokerNotes.netAmount,
  fileName: brokerNotes.fileName,
  createdAt: brokerNotes.createdAt,
  // Spelled out: Drizzle renders columns of a single-table select without
  // their table, which would bind the outer id to `transactions.id`.
  tradeCount: sql<number>`(
    select count(*)::int from "transactions" as "note_trades"
    where "note_trades"."broker_note_id" = "broker_notes"."id"
  )`,
};

type SummaryRow = {
  id: string;
  format: string;
  noteNumber: string | null;
  tradeDate: string;
  settlementDate: string | null;
  currency: BrokerNoteList["items"][number]["currency"];
  purchasesTotal: string;
  salesTotal: string;
  feesTotal: string;
  withheldTax: string;
  netAmount: string;
  fileName: string;
  createdAt: Date;
  tradeCount: number;
};

function toSummary(row: SummaryRow): BrokerNoteList["items"][number] {
  const { createdAt, ...rest } = row;

  return {
    ...rest,
    format: rest.format as BrokerNoteList["items"][number]["format"],
    tradeCount: Number(rest.tradeCount),
    importedAt: createdAt.toISOString(),
  };
}

export const brokerNotesRouter = router({
  /**
   * Reads the uploaded PDFs and reports what importing them would do. Writes
   * nothing; the same files are sent again to import.
   */
  preview: protectedProcedure
    .input(brokerNotePreviewInput)
    .mutation(async ({ ctx, input }): Promise<BrokerNotePreview> => {
      const { files, documents } = await readDocuments(input.files);
      const mappings = new Map(
        input.mappings.map((m) => [m.sourceKey, m.ticker]),
      );
      const ledger = await loadLedgerContext(
        db,
        ctx.user.id,
        documents,
        mappings,
      );
      const plan = planFor(input, documents, ledger, null);

      return {
        files,
        notes: plan.notes.map((note) =>
          previewNote(note, plan, ledger.history),
        ),
        securities: plan.securities,
        newTickers: plan.newTickers,
      };
    }),

  /**
   * Imports the selected notes all-or-nothing. The files are parsed again
   * and the whole plan is re-validated under the ticker locks, so nothing
   * the preview showed can be stale.
   */
  import: protectedProcedure
    .input(brokerNoteImportInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const selected = new Set(input.fingerprints);
      const { documents } = await readDocuments(input.files);
      const mappings = new Map(
        input.mappings.map((m) => [m.sourceKey, m.ticker]),
      );
      const tradeDates = documents.flatMap((document) =>
        document.notes.map((note) => note.tradeDate),
      );
      // Resolved before the ledger locks so a slow BCB call never holds them.
      let rates = new Map<string, { rate: string }>();
      try {
        rates = await tradeDateRates(tradeDates);
      } catch {
        // Stored without a rate; filled later from Transactions.
      }

      try {
        return await db.transaction(async (tx) => {
          const unlocked = await loadLedgerContext(
            tx,
            userId,
            documents,
            mappings,
          );
          await lockTickers(tx, userId, unlocked.tickers);
          const ledger = await loadLedgerContext(
            tx,
            userId,
            documents,
            mappings,
          );

          // A mapping saved meanwhile could point at a ticker left unlocked.
          if (
            ledger.tickers.some((ticker) => !unlocked.tickers.includes(ticker))
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Security mappings changed meanwhile. Try again.",
            });
          }
          const plan = planFor(input, documents, ledger, selected);
          const chosen = plan.notes.filter(
            (note) => selected.has(note.fingerprint) && note.status === "ready",
          );
          const uniqueChosen = new Set(chosen.map((note) => note.fingerprint));

          if (uniqueChosen.size !== selected.size) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "Some selected notes cannot be imported anymore. Review the files again.",
            });
          }

          let transactionCount = 0;

          for (const planned of chosen) {
            const { note } = planned;
            const [row] = await tx
              .insert(brokerNotes)
              .values({
                userId,
                format: note.format,
                fingerprint: planned.fingerprint,
                fileName: planned.fileName,
                fileSha256: planned.sha256,
                noteNumber: note.noteNumber,
                account: note.account,
                tradeDate: note.tradeDate,
                settlementDate: note.settlementDate,
                currency: note.currency,
                purchasesTotal: note.purchasesTotal,
                salesTotal: note.salesTotal,
                feesTotal: note.feesTotal,
                withheldTax: note.withheldTax,
                netAmount: note.netAmount,
                details: {
                  version: 1,
                  fees: note.fees,
                  withheldTaxBase: note.withheldTaxBase,
                  lines: planned.lines,
                },
              })
              .returning({ id: brokerNotes.id });

            if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await tx.insert(transactions).values(
              planned.drafts.map((draft) => ({
                ...draft,
                userId,
                usdBrlRate: rates.get(draft.tradedAt)?.rate ?? null,
                brokerNoteId: row.id,
              })),
            );
            transactionCount += planned.drafts.length;
          }

          // Every ticker the user confirmed for a security of this upload is
          // remembered, including those of notes left for later.
          const aliases = new Map<string, string>();
          const printedWithoutTicker = new Set(
            documents.flatMap((document) =>
              document.notes.flatMap((note) =>
                note.trades
                  .filter((trade) => trade.ticker === null)
                  .map((trade) => trade.sourceKey),
              ),
            ),
          );
          for (const [sourceKey, ticker] of mappings) {
            if (printedWithoutTicker.has(sourceKey))
              aliases.set(sourceKey, ticker);
          }
          for (const planned of chosen) {
            planned.lines.forEach((line, index) => {
              const ticker = planned.tickers[index];
              if (line.documentTicker === null && ticker) {
                aliases.set(line.sourceKey, ticker);
              }
            });
          }
          for (const [sourceKey, ticker] of aliases) {
            await tx
              .insert(brokerSecurityAliases)
              .values({ userId, sourceKey, ticker })
              .onConflictDoUpdate({
                target: [
                  brokerSecurityAliases.userId,
                  brokerSecurityAliases.sourceKey,
                ],
                set: { ticker, updatedAt: new Date() },
              });
          }

          return { notes: chosen.length, transactions: transactionCount };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "One of these notes was imported meanwhile.",
          });
        }
        throw error;
      }
    }),

  list: protectedProcedure
    .input(brokerNoteListInput)
    .query(async ({ ctx, input }): Promise<BrokerNoteList> => {
      const where = eq(brokerNotes.userId, ctx.user.id);
      const [rows, totals] = await Promise.all([
        db
          .select(summaryColumns)
          .from(brokerNotes)
          .where(where)
          .orderBy(
            desc(brokerNotes.tradeDate),
            desc(brokerNotes.createdAt),
            desc(brokerNotes.id),
          )
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        db.select({ value: count() }).from(brokerNotes).where(where),
      ]);

      return {
        items: rows.map(toSummary),
        total: Number(totals[0]?.value ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  get: protectedProcedure
    .input(brokerNoteIdInput)
    .query(async ({ ctx, input }): Promise<BrokerNoteDetail> => {
      const [row] = await db
        .select({
          ...summaryColumns,
          account: brokerNotes.account,
          fileSha256: brokerNotes.fileSha256,
          details: brokerNotes.details,
        })
        .from(brokerNotes)
        .where(
          and(
            eq(brokerNotes.id, input.id),
            eq(brokerNotes.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      }

      const trades = await db
        .select({
          id: transactions.id,
          ticker: transactions.ticker,
          assetClass: transactions.assetClass,
          side: transactions.side,
          quantity: transactions.quantity,
          price: transactions.price,
          fees: transactions.fees,
          usdBrlRate: transactions.usdBrlRate,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.brokerNoteId, row.id),
            eq(transactions.userId, ctx.user.id),
          ),
        )
        .orderBy(asc(transactions.createdAt), asc(transactions.id));
      const { account, fileSha256, details, ...summary } = row;

      return {
        ...toSummary(summary),
        account,
        fileSha256,
        details,
        trades: trades.map((trade) => ({
          ...trade,
          assetClass: trade.assetClass as AssetClass,
          total: tradeCashTotal(trade),
        })),
      };
    }),

  /**
   * Deletes a note and every trade imported from it, refused when a later
   * sale would be left without the shares the note's buys provided.
   */
  remove: protectedProcedure
    .input(brokerNoteIdInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      return db.transaction(async (tx) => {
        const [note] = await tx
          .select({ id: brokerNotes.id })
          .from(brokerNotes)
          .where(
            and(eq(brokerNotes.id, input.id), eq(brokerNotes.userId, userId)),
          )
          .limit(1);

        if (!note) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
        }

        // A note's trades never change ticker, so reading them before the
        // lock is safe; the lock then guards the ledgers being replayed.
        const trades = await tx
          .select({ id: transactions.id, ticker: transactions.ticker })
          .from(transactions)
          .where(
            and(
              eq(transactions.brokerNoteId, note.id),
              eq(transactions.userId, userId),
            ),
          );
        const tickers = [...new Set(trades.map((trade) => trade.ticker))];
        const removed = new Set(trades.map((trade) => trade.id));

        await lockTickers(tx, userId, tickers);
        const [history, splits] = await Promise.all([
          readIdentifiedHistory(tx, userId, tickers),
          readSplits(tx, userId, tickers),
        ]);
        const remaining = adjustForSplits(
          history.filter((entry) => !removed.has(entry.id)),
          splits,
        );

        for (const ticker of tickers.sort()) {
          const available = availableBeforeOversell(remaining, ticker);

          if (available !== null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Removing this note would oversell ${ticker}: only ${available} would be available for a later sale.`,
            });
          }
        }

        await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.brokerNoteId, note.id),
              eq(transactions.userId, userId),
            ),
          );
        await tx
          .delete(brokerNotes)
          .where(
            and(eq(brokerNotes.id, note.id), eq(brokerNotes.userId, userId)),
          );

        return { id: note.id, transactions: trades.length };
      });
    }),
});
