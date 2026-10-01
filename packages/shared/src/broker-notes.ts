import { z } from "zod";
import { brokerNoteFormatSchema } from "./broker-note-formats";
import { currencySchema } from "./currency";
import {
  type AssetClass,
  assetClassSchema,
  tickerSchema,
  transactionSideSchema,
} from "./transactions";

export const MAX_BROKER_NOTE_FILES = 20;
export const MAX_BROKER_NOTE_FILE_BYTES = 5 * 1024 * 1024;
/** Base64 grows 4 characters for every 3 bytes, plus padding. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_BROKER_NOTE_FILE_BYTES / 3) * 4;

/** Asset classes a broker-note trade can be booked as. */
export const BROKER_NOTE_ASSET_CLASSES = [
  "stock_br",
  "stock_us",
  "reit",
  "etf",
  "bdr",
  "other",
] as const satisfies readonly AssetClass[];
export const brokerNoteAssetClassSchema = z.enum(BROKER_NOTE_ASSET_CLASSES);

/**
 * A B3 cash-market ticker: four letters or digits plus the class digits
 * (`PETR4`, `B3SA3`, `BPAC11`). The fractional suffix `F` is not a ticker.
 */
export const b3TickerSchema = tickerSchema.pipe(
  z
    .string()
    .regex(/^[A-Z0-9]{4}\d{1,2}$/, "Use a B3 ticker such as PETR4 or BPAC11"),
);

export const brokerNoteFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  contentBase64: z
    .string()
    .min(1)
    .max(MAX_BASE64_LENGTH, "Each file must be at most 5 MB"),
});

/** The user's ticker for a security printed without one. */
export const brokerNoteMappingSchema = z.object({
  sourceKey: z.string().trim().min(1).max(200),
  ticker: b3TickerSchema,
});

/** The asset class chosen for a ticker that has no trade yet. */
export const brokerNoteClassChoiceSchema = z.object({
  ticker: tickerSchema,
  assetClass: brokerNoteAssetClassSchema,
});

export const brokerNotePreviewInput = z.object({
  files: z
    .array(brokerNoteFileSchema)
    .min(1, "Select at least one PDF")
    .max(
      MAX_BROKER_NOTE_FILES,
      `Select at most ${MAX_BROKER_NOTE_FILES} files at once`,
    ),
  mappings: z.array(brokerNoteMappingSchema).max(500).default([]),
  assetClasses: z.array(brokerNoteClassChoiceSchema).max(500).default([]),
});

export type BrokerNotePreviewInput = z.input<typeof brokerNotePreviewInput>;

export const brokerNoteFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Invalid note fingerprint");

export const brokerNoteImportInput = brokerNotePreviewInput.extend({
  /** Notes of the preview the user chose to import. */
  fingerprints: z
    .array(brokerNoteFingerprintSchema)
    .min(1, "Select at least one note")
    .max(200),
});

export type BrokerNoteImportInput = z.input<typeof brokerNoteImportInput>;

/** Why a whole file could not be read. */
export const BROKER_NOTE_FILE_ERRORS = [
  "not_pdf",
  "too_large",
  "password_protected",
  "unreadable",
  "too_many_pages",
  "unknown_format",
  "unsupported_market",
  "invalid_layout",
  "reconciliation_failed",
] as const;
export const brokerNoteFileErrorSchema = z.enum(BROKER_NOTE_FILE_ERRORS);
export type BrokerNoteFileError = z.infer<typeof brokerNoteFileErrorSchema>;

/** Why a parsed note cannot be imported as it stands. */
export const BROKER_NOTE_ISSUES = [
  "unmapped_security",
  "currency_conflict",
  "fixed_income_conflict",
  "oversell",
] as const;
export const brokerNoteIssueCodeSchema = z.enum(BROKER_NOTE_ISSUES);
export type BrokerNoteIssueCode = z.infer<typeof brokerNoteIssueCodeSchema>;

export const BROKER_NOTE_STATUSES = [
  "ready",
  "blocked",
  "imported",
  "duplicate",
] as const;
export const brokerNoteStatusSchema = z.enum(BROKER_NOTE_STATUSES);
export type BrokerNoteStatus = z.infer<typeof brokerNoteStatusSchema>;

export const brokerNoteIssueSchema = z.object({
  code: brokerNoteIssueCodeSchema,
  ticker: z.string().nullable(),
  /** Quantity still held before the uncovered sale (`oversell`). */
  available: z.string().nullable(),
  /** Description of the unmapped security (`unmapped_security`). */
  description: z.string().nullable(),
});

export type BrokerNoteIssue = z.infer<typeof brokerNoteIssueSchema>;

/** One fee item exactly as the document prints it, positive = cost. */
export const brokerNoteFeeSchema = z.object({
  label: z.string(),
  amount: z.string(),
});

export type BrokerNoteFee = z.infer<typeof brokerNoteFeeSchema>;

/**
 * One trade line as read from the document plus the values booked from it.
 * `price` and `fees` are what the ledger stores; `executionPrice` and
 * `grossValue` are the document's own numbers.
 */
export const brokerNoteLineSchema = z.object({
  side: transactionSideSchema,
  /** Stable key of the security across notes, e.g. `B3:ELETROBRAS|PNB`. */
  sourceKey: z.string(),
  /** Security as printed, e.g. `PNB N1 ELETROBRAS`. */
  description: z.string(),
  /** Ticker printed by the document, `null` when it only prints a name. */
  documentTicker: z.string().nullable(),
  quantity: z.string(),
  executionPrice: z.string(),
  grossValue: z.string(),
  price: z.string(),
  fees: z.string(),
  /** `VIS`, `FRA` or the US capacity (`Agency`, `Principal`). */
  market: z.string().nullable(),
  /** Observation flags printed next to the trade (`D` = day trade). */
  flags: z.array(z.string()),
  settlementDate: z.string().nullable(),
  /** Broker references worth keeping for an audit (CUSIP, trade id). */
  references: z.record(z.string(), z.string()),
});

export type BrokerNoteLine = z.infer<typeof brokerNoteLineSchema>;

/**
 * Audit snapshot of the source document stored with the note. Calculations
 * never read it; the ledger reads the booked transactions.
 */
export const brokerNoteDetailsSchema = z.object({
  version: z.literal(1),
  fees: z.array(brokerNoteFeeSchema),
  withheldTaxBase: z.string().nullable(),
  lines: z.array(brokerNoteLineSchema),
});

export type BrokerNoteDetails = z.infer<typeof brokerNoteDetailsSchema>;

export const brokerNotePreviewTradeSchema = brokerNoteLineSchema.extend({
  /** Resolved ticker, `null` until the security is mapped. */
  ticker: z.string().nullable(),
  assetClass: assetClassSchema.nullable(),
  /** Cash of the trade: fees added to a buy, subtracted from a sell. */
  total: z.string(),
  /** A manual trade with the same ticker, day, side and quantity exists. */
  possibleDuplicate: z.boolean(),
});

export type BrokerNotePreviewTrade = z.infer<
  typeof brokerNotePreviewTradeSchema
>;

const noteTotalsShape = {
  format: brokerNoteFormatSchema,
  noteNumber: z.string().nullable(),
  tradeDate: z.string(),
  settlementDate: z.string().nullable(),
  currency: currencySchema,
  purchasesTotal: z.string(),
  salesTotal: z.string(),
  /** Costs of the note; negative only when a broker credit exceeds fees. */
  feesTotal: z.string(),
  withheldTax: z.string(),
  /** Signed settlement: positive is credited to the investor. */
  netAmount: z.string(),
};

export const brokerNotePreviewNoteSchema = z.object({
  ...noteTotalsShape,
  fingerprint: brokerNoteFingerprintSchema,
  fileName: z.string(),
  status: brokerNoteStatusSchema,
  issues: z.array(brokerNoteIssueSchema),
  fees: z.array(brokerNoteFeeSchema),
  trades: z.array(brokerNotePreviewTradeSchema),
});

export type BrokerNotePreviewNote = z.infer<typeof brokerNotePreviewNoteSchema>;

export const brokerNotePreviewSchema = z.object({
  files: z.array(
    z.object({
      fileName: z.string(),
      sha256: z.string(),
      error: brokerNoteFileErrorSchema.nullable(),
      /** Technical reason for `error`, in English. */
      errorDetail: z.string().nullable(),
      noteCount: z.number().int().nonnegative(),
    }),
  ),
  notes: z.array(brokerNotePreviewNoteSchema),
  /** Securities printed without a ticker, with their current mapping. */
  securities: z.array(
    z.object({
      sourceKey: z.string(),
      description: z.string(),
      ticker: z.string().nullable(),
      /** The mapping comes from an earlier import, not from this request. */
      saved: z.boolean(),
    }),
  ),
  /** Tickers that will be traded for the first time. */
  newTickers: z.array(
    z.object({
      ticker: z.string(),
      currency: currencySchema,
      suggestedClass: brokerNoteAssetClassSchema,
      assetClass: brokerNoteAssetClassSchema,
    }),
  ),
});

export type BrokerNotePreview = z.infer<typeof brokerNotePreviewSchema>;

export const brokerNoteImportResultSchema = z.object({
  notes: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
});

export const brokerNoteListInput = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export const brokerNoteSummarySchema = z.object({
  ...noteTotalsShape,
  id: z.string(),
  fileName: z.string(),
  tradeCount: z.number().int().nonnegative(),
  importedAt: z.string(),
});

export type BrokerNoteSummary = z.infer<typeof brokerNoteSummarySchema>;

export const brokerNoteListSchema = z.object({
  items: z.array(brokerNoteSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
});

export type BrokerNoteList = z.infer<typeof brokerNoteListSchema>;

export const brokerNoteIdInput = z.object({ id: z.uuid() });

export const brokerNoteDetailSchema = brokerNoteSummarySchema.extend({
  account: z.string().nullable(),
  fileSha256: z.string(),
  details: brokerNoteDetailsSchema,
  trades: z.array(
    z.object({
      id: z.string(),
      ticker: z.string(),
      assetClass: assetClassSchema,
      side: transactionSideSchema,
      quantity: z.string(),
      price: z.string(),
      fees: z.string(),
      total: z.string(),
      usdBrlRate: z.string().nullable(),
    }),
  ),
});

export type BrokerNoteDetail = z.infer<typeof brokerNoteDetailSchema>;
