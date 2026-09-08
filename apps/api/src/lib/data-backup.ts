import { createHash } from "node:crypto";
import {
  ASSET_CLASSES,
  CURRENCIES,
  DEFAULT_CONTRIBUTION_PLAN_CONFIG,
  TRANSACTION_SIDES,
} from "@portifolio-tracker/shared";
import { z } from "zod";

export const BACKUP_FORMAT = "portifolio-tracker-backup";
export const BACKUP_VERSION = 6;
export const BACKUP_MEDIA_TYPE = "application/x-portifolio-backup+gzip";

/**
 * Explicit, defensive bounds for an untrusted upload. A malformed or hostile
 * backup must fail fast on a fixed budget instead of exhausting memory: a gzip
 * bomb inflates a tiny request into gigabytes, and a single unterminated line
 * would otherwise buffer without limit. Every bound is deliberately generous
 * for a personal account yet finite.
 */
/** Largest accepted compressed request body. */
export const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
/** Largest accepted total decompressed payload. */
export const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;
/** Largest accepted single newline-delimited line. */
export const MAX_LINE_BYTES = 10 * 1024 * 1024;
/** Largest accepted number of lines, including the manifest and checksum. */
export const MAX_LINES = 2_000_000;
/** Largest accepted number of data records across all entities. */
export const MAX_RECORDS = 1_000_000;

export const BACKUP_ENTITIES = [
  "categories",
  "allocationAssets",
  "cashBalances",
  "assetReviews",
  "transactions",
  "assetCategories",
  "scoreConfigs",
  "contributionPlanConfigs",
] as const;

export type BackupEntity = (typeof BACKUP_ENTITIES)[number];
export type BackupCounts = Record<BackupEntity, number>;

/**
 * Decimal values that must round-trip a Postgres `numeric(22, 8)` column
 * without loss: at most 14 integer digits and 8 fractional digits. The old
 * unbounded pattern would accept a value the database then silently rounds or
 * rejects, so validation now matches the stored precision exactly.
 */
const DECIMAL_DIGITS_PATTERN = /^\d{1,14}(?:\.\d{1,8})?$/;
/** Signed variant for columns that legitimately store negatives (grades never, cash can). */
const signedDecimal = z
  .string()
  .regex(/^-?\d{1,14}(?:\.\d{1,8})?$/, "decimal exceeds numeric(22, 8)");
/** Non-negative decimal: rejects a leading minus while keeping numeric(22, 8) bounds. */
const decimal = z
  .string()
  .regex(DECIMAL_DIGITS_PATTERN, "decimal exceeds numeric(22, 8)");
const nullableDecimal = decimal.nullable();
/** Strictly positive decimal: a traded quantity or price is never zero or negative. */
const positiveDecimal = decimal.refine(
  (value) => /[1-9]/.test(value),
  "must be greater than zero",
);
const timestamp = z.iso.datetime({ offset: true });
const databaseTimestamp = timestamp.transform((value) => new Date(value));

const backupCountsSchema = z.strictObject({
  categories: z.number().int().nonnegative(),
  allocationAssets: z.number().int().nonnegative(),
  cashBalances: z.number().int().nonnegative().default(0),
  assetReviews: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
  assetCategories: z.number().int().nonnegative(),
  scoreConfigs: z.number().int().nonnegative().default(0),
  contributionPlanConfigs: z.number().int().nonnegative().default(0),
});

export const manifestSchema = z.object({
  type: z.literal("manifest"),
  format: z.literal(BACKUP_FORMAT),
  version: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  exportedAt: timestamp,
  counts: backupCountsSchema,
});

export type BackupManifest = z.infer<typeof manifestSchema>;

const categoryRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("categories"),
  data: z.strictObject({
    ref: z.uuid(),
    name: z.string().min(1),
    color: z.string().min(1),
    sortOrder: z.number().int(),
    createdAt: databaseTimestamp,
    updatedAt: databaseTimestamp,
  }),
});

const allocationAssetRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("allocationAssets"),
  data: z.strictObject({
    ticker: z.string().min(1),
    assetClass: z.enum(ASSET_CLASSES),
    currency: z.enum(CURRENCIES),
    targetWeight: nullableDecimal,
    valuationRef: z.string().nullable(),
    manualPrice: nullableDecimal,
    sortOrder: z.number().int(),
    markColor: z.string().nullable().optional(),
    createdAt: databaseTimestamp,
    updatedAt: databaseTimestamp,
  }),
});

const cashBalanceRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("cashBalances"),
  data: z.strictObject({
    amount: signedDecimal,
    updatedAt: databaseTimestamp,
  }),
});

const assetReviewRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("assetReviews"),
  data: z.strictObject({
    ticker: z.string().min(1),
    period: z.string().min(1),
    grade: nullableDecimal,
    notes: z.string().nullable(),
    fairValue: nullableDecimal,
    fairValueRef: z.string().nullable(),
    watchNext: z.boolean().optional().default(false),
    createdAt: databaseTimestamp,
    updatedAt: databaseTimestamp,
  }),
});

const transactionRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("transactions"),
  data: z.strictObject({
    ticker: z.string().min(1),
    assetClass: z.enum(ASSET_CLASSES),
    currency: z.enum(CURRENCIES),
    side: z.enum(TRANSACTION_SIDES),
    quantity: positiveDecimal,
    price: positiveDecimal,
    fees: decimal,
    tradedAt: z.iso.date(),
    notes: z.string().nullable(),
    createdAt: databaseTimestamp,
  }),
});

const assetCategoryRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("assetCategories"),
  data: z.strictObject({
    ticker: z.string().min(1),
    categoryRef: z.uuid(),
    createdAt: databaseTimestamp,
    updatedAt: databaseTimestamp,
  }),
});

const scoreConfigRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("scoreConfigs"),
  data: z.strictObject({
    version: z.string().min(1),
    absoluteWeightCap: decimal,
    overweightBlockFactor: decimal,
    trimFactor: decimal,
    cooldownDays: z.number().int().nonnegative(),
    gradeWindowQuarters: z.number().int().positive(),
    gradeBands: z
      .array(
        z.strictObject({
          minGrade: decimal,
          multiplier: decimal,
        }),
      )
      .min(1),
    ungradedMultiplier: decimal,
    updatedAt: databaseTimestamp,
  }),
});

const contributionPlanConfigRecord = z.strictObject({
  type: z.literal("record"),
  entity: z.literal("contributionPlanConfigs"),
  data: z.union([
    z.strictObject({
      version: z.string().min(1),
      smallBookImpact: decimal,
      largeBookImpact: decimal,
      maxShare: decimal,
      maxAssets: z.number().int().positive(),
      updatedAt: databaseTimestamp,
    }),
    z
      .strictObject({
        version: z.string().min(1),
        minWeightImpact: decimal,
        maxShare: decimal,
        maxAssets: z.number().int().positive(),
        updatedAt: databaseTimestamp,
      })
      .transform((row) => ({
        version: row.version,
        smallBookImpact: DEFAULT_CONTRIBUTION_PLAN_CONFIG.smallBookImpact,
        largeBookImpact: DEFAULT_CONTRIBUTION_PLAN_CONFIG.largeBookImpact,
        maxShare: row.maxShare,
        maxAssets: row.maxAssets,
        updatedAt: row.updatedAt,
      })),
  ]),
});

export const backupRecordSchema = z.discriminatedUnion("entity", [
  categoryRecord,
  allocationAssetRecord,
  cashBalanceRecord,
  assetReviewRecord,
  transactionRecord,
  assetCategoryRecord,
  scoreConfigRecord,
  contributionPlanConfigRecord,
]);

export type BackupRecord = z.infer<typeof backupRecordSchema>;

export const checksumSchema = z.strictObject({
  type: z.literal("checksum"),
  algorithm: z.literal("sha256"),
  value: z.string().regex(/^[a-f0-9]{64}$/),
});

export function encodeBackupLine(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}

export function createBackupHash() {
  return createHash("sha256");
}

export function emptyBackupCounts(): BackupCounts {
  return {
    categories: 0,
    allocationAssets: 0,
    cashBalances: 0,
    assetReviews: 0,
    transactions: 0,
    assetCategories: 0,
    scoreConfigs: 0,
    contributionPlanConfigs: 0,
  };
}

export async function* decodeLines(
  stream: ReadableStream<Uint8Array>,
  {
    maxLineBytes = MAX_LINE_BYTES,
    maxTotalBytes = MAX_DECOMPRESSED_BYTES,
    maxLines = MAX_LINES,
  }: {
    maxLineBytes?: number;
    maxTotalBytes?: number;
    maxLines?: number;
  } = {},
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  let totalBytes = 0;
  let emitted = 0;

  const guardLine = () => {
    if (Buffer.byteLength(buffered, "utf8") > maxLineBytes) {
      throw new Error(
        `Backup contains a line larger than ${maxLineBytes} bytes`,
      );
    }
  };
  const countLine = () => {
    emitted += 1;
    if (emitted > maxLines) {
      throw new Error(`Backup contains more than ${maxLines} lines`);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bound the inflated payload before it is decoded, so a gzip bomb is
      // rejected on a fixed budget instead of buffering without limit.
      totalBytes += value.byteLength;
      if (totalBytes > maxTotalBytes) {
        throw new Error(
          `Backup exceeds the ${maxTotalBytes}-byte decompressed limit`,
        );
      }
      buffered += decoder.decode(value, { stream: true });

      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        if (
          Buffer.byteLength(buffered.slice(0, newline), "utf8") > maxLineBytes
        ) {
          throw new Error(
            `Backup contains a line larger than ${maxLineBytes} bytes`,
          );
        }
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        countLine();
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        newline = buffered.indexOf("\n");
      }
      guardLine();
    }

    buffered += decoder.decode();
    guardLine();
    if (buffered.length > 0) {
      countLine();
      yield buffered;
    }
  } finally {
    reader.releaseLock();
  }
}
