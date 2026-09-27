import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { db } from "../../db";
import { allocationAssets, assetReviews, transactions } from "../../db/schema";
import type {
  AllocationAssetMeta,
  StoredReview,
} from "../../domain/allocation";
import { normalizeAssetClass, parseMarkColor } from "./allocation-helpers";

type DbExecutor =
  | Parameters<Parameters<typeof db.transaction>[0]>[0]
  | typeof db;

export async function loadAssets(
  userId: string,
): Promise<AllocationAssetMeta[]> {
  const rows = await db
    .select()
    .from(allocationAssets)
    .where(eq(allocationAssets.userId, userId))
    .orderBy(asc(allocationAssets.sortOrder), asc(allocationAssets.ticker));

  return rows.map((row) => ({
    ticker: row.ticker,
    assetClass: normalizeAssetClass(row.assetClass),
    currency: row.currency,
    targetWeight: row.targetWeight,
    valuationRef: row.valuationRef,
    manualPrice: row.manualPrice,
    markColor: parseMarkColor(row.markColor),
    sortOrder: row.sortOrder,
  }));
}

export async function loadAsset(
  userId: string,
  ticker: string,
): Promise<AllocationAssetMeta | null> {
  const [row] = await db
    .select()
    .from(allocationAssets)
    .where(
      and(
        eq(allocationAssets.userId, userId),
        eq(allocationAssets.ticker, ticker),
      ),
    )
    .limit(1);

  return row
    ? {
        ticker: row.ticker,
        assetClass: normalizeAssetClass(row.assetClass),
        currency: row.currency,
        targetWeight: row.targetWeight,
        valuationRef: row.valuationRef,
        manualPrice: row.manualPrice,
        markColor: parseMarkColor(row.markColor),
        sortOrder: row.sortOrder,
      }
    : null;
}

export async function loadReviews(userId: string): Promise<StoredReview[]> {
  return db
    .select({
      ticker: assetReviews.ticker,
      period: assetReviews.period,
      grade: assetReviews.grade,
      notes: assetReviews.notes,
      fairValue: assetReviews.fairValue,
      fairValueRef: assetReviews.fairValueRef,
      watchNext: assetReviews.watchNext,
      // Local day of the last edit: when the fair value was known.
      editedOn: sql<string>`to_char(${assetReviews.updatedAt} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')`,
    })
    .from(assetReviews)
    .where(eq(assetReviews.userId, userId))
    .orderBy(asc(assetReviews.ticker), asc(assetReviews.period));
}

/**
 * Class and currency of a ticker as the trade log knows it, so a metadata
 * row created by an inline edit never contradicts its own transactions.
 */
export async function tradedIdentity(
  userId: string,
  ticker: string,
): Promise<{ assetClass: AssetClass; currency: Currency } | null> {
  const [row] = await db
    .select({
      assetClass: transactions.assetClass,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), eq(transactions.ticker, ticker)),
    )
    .orderBy(desc(transactions.tradedAt))
    .limit(1);

  return row
    ? {
        assetClass: normalizeAssetClass(row.assetClass),
        currency: row.currency,
      }
    : null;
}

export async function nextSortOrder(
  userId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const [row] = await executor
    .select({ highest: max(allocationAssets.sortOrder) })
    .from(allocationAssets)
    .where(eq(allocationAssets.userId, userId));

  return (row?.highest ?? 0) + 1;
}

/** Ensures reviews and manual ordering always have an allocation asset row. */
export async function ensureAsset(
  userId: string,
  ticker: string,
): Promise<void> {
  const traded = await tradedIdentity(userId, ticker);

  await db
    .insert(allocationAssets)
    .values({
      userId,
      ticker,
      assetClass: traded?.assetClass ?? "other",
      currency: traded?.currency ?? "USD",
      sortOrder: await nextSortOrder(userId),
    })
    .onConflictDoNothing({
      target: [allocationAssets.userId, allocationAssets.ticker],
    });
}
