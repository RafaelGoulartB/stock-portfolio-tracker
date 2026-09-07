import { createHash } from "node:crypto";
import {
  ASSET_CLASSES,
  CURRENCIES,
  TRANSACTION_SIDES,
} from "@portifolio-tracker/shared";
import { z } from "zod";

export const BACKUP_FORMAT = "portifolio-tracker-backup";
export const BACKUP_VERSION = 2;
export const BACKUP_MEDIA_TYPE = "application/x-portifolio-backup+gzip";

export const BACKUP_ENTITIES = [
  "categories",
  "allocationAssets",
  "assetReviews",
  "transactions",
  "assetCategories",
  "scoreConfigs",
] as const;

export type BackupEntity = (typeof BACKUP_ENTITIES)[number];
export type BackupCounts = Record<BackupEntity, number>;

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const nullableDecimal = decimal.nullable();
const timestamp = z.iso.datetime({ offset: true });
const databaseTimestamp = timestamp.transform((value) => new Date(value));

const backupCountsSchema = z.strictObject({
  categories: z.number().int().nonnegative(),
  allocationAssets: z.number().int().nonnegative(),
  assetReviews: z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
  assetCategories: z.number().int().nonnegative(),
  scoreConfigs: z.number().int().nonnegative().default(0),
});

export const manifestSchema = z.object({
  type: z.literal("manifest"),
  format: z.literal(BACKUP_FORMAT),
  version: z.union([z.literal(1), z.literal(2)]),
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
    quantity: decimal,
    price: decimal,
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

export const backupRecordSchema = z.discriminatedUnion("entity", [
  categoryRecord,
  allocationAssetRecord,
  assetReviewRecord,
  transactionRecord,
  assetCategoryRecord,
  scoreConfigRecord,
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
    assetReviews: 0,
    transactions: 0,
    assetCategories: 0,
    scoreConfigs: 0,
  };
}

export async function* decodeLines(
  stream: ReadableStream<Uint8Array>,
  maxLineBytes = 10 * 1024 * 1024,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        if (
          Buffer.byteLength(buffered.slice(0, newline), "utf8") > maxLineBytes
        ) {
          throw new Error("Backup contains a line larger than 10 MiB");
        }
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        newline = buffered.indexOf("\n");
      }
      if (Buffer.byteLength(buffered, "utf8") > maxLineBytes) {
        throw new Error("Backup contains a line larger than 10 MiB");
      }
    }

    buffered += decoder.decode();
    if (Buffer.byteLength(buffered, "utf8") > maxLineBytes) {
      throw new Error("Backup contains a line larger than 10 MiB");
    }
    if (buffered.length > 0) yield buffered;
  } finally {
    reader.releaseLock();
  }
}
