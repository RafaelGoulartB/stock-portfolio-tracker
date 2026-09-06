import {
  type AssetClass,
  assignCategoryInput,
  assignManyCategoriesInput,
  type CategorizedAsset,
  type Category,
  type CategoryColor,
  categoryColorSchema,
  createCategoryInput,
  deleteCategoryInput,
  updateCategoryInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  allocationAssets,
  assetCategories,
  categories,
  transactions,
} from "../../db/schema";
import {
  type AssetRef,
  categoryNameTaken,
  mergeAssetUniverse,
  nextCategoryColor,
} from "../../domain/categories";
import { protectedProcedure, router } from "../trpc";

const UNCATEGORIZED = null;

function normalizeAssetClass(value: string): AssetClass {
  return (value === "stock" ? "stock_br" : value) as AssetClass;
}

function asColor(value: string): CategoryColor {
  const parsed = categoryColorSchema.safeParse(value);

  return parsed.success ? parsed.data : "chart-1";
}

async function loadCategories(userId: string) {
  return db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

async function ownedCategory(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .limit(1);

  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Category not found",
    });
  }

  return row;
}

async function nextSortOrder(userId: string): Promise<number> {
  const [row] = await db
    .select({ highest: max(categories.sortOrder) })
    .from(categories)
    .where(eq(categories.userId, userId));

  return (row?.highest ?? 0) + 1;
}

async function loadTradedIdentities(
  userId: string,
): Promise<Omit<AssetRef, "traded">[]> {
  const rows = await db
    .select({
      ticker: transactions.ticker,
      assetClass: transactions.assetClass,
      currency: transactions.currency,
      tradedAt: transactions.tradedAt,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.tradedAt), desc(transactions.createdAt));

  const latest = new Map<string, Omit<AssetRef, "traded">>();

  for (const row of rows) {
    if (latest.has(row.ticker)) {
      continue;
    }

    latest.set(row.ticker, {
      ticker: row.ticker,
      assetClass: normalizeAssetClass(row.assetClass),
      currency: row.currency,
    });
  }

  return [...latest.values()];
}

async function loadWatchedIdentities(
  userId: string,
): Promise<Omit<AssetRef, "traded">[]> {
  const rows = await db
    .select({
      ticker: allocationAssets.ticker,
      assetClass: allocationAssets.assetClass,
      currency: allocationAssets.currency,
    })
    .from(allocationAssets)
    .where(eq(allocationAssets.userId, userId));

  return rows.map((row) => ({
    ticker: row.ticker,
    assetClass: normalizeAssetClass(row.assetClass),
    currency: row.currency,
  }));
}

async function loadAssignments(userId: string) {
  return db
    .select({
      ticker: assetCategories.ticker,
      categoryId: assetCategories.categoryId,
    })
    .from(assetCategories)
    .where(eq(assetCategories.userId, userId));
}

async function knownTickers(userId: string): Promise<Set<string>> {
  const [traded, watched, assignments] = await Promise.all([
    loadTradedIdentities(userId),
    loadWatchedIdentities(userId),
    loadAssignments(userId),
  ]);

  return new Set([
    ...traded.map((row) => row.ticker),
    ...watched.map((row) => row.ticker),
    ...assignments.map((row) => row.ticker),
  ]);
}

async function listPayload(userId: string): Promise<{
  categories: Category[];
  assets: CategorizedAsset[];
}> {
  const [rows, traded, watched, assignments] = await Promise.all([
    loadCategories(userId),
    loadTradedIdentities(userId),
    loadWatchedIdentities(userId),
    loadAssignments(userId),
  ]);

  const categoryByTicker = new Map(
    assignments.map((row) => [row.ticker, row.categoryId]),
  );
  const assets = mergeAssetUniverse(
    traded,
    watched,
    assignments.map((row) => row.ticker),
  );
  const counts = new Map<string, number>();

  for (const asset of assets) {
    const categoryId = categoryByTicker.get(asset.ticker);

    if (categoryId) {
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
  }

  return {
    categories: rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: asColor(row.color),
      sortOrder: row.sortOrder,
      assetCount: counts.get(row.id) ?? 0,
    })),
    assets: assets.map((asset) => ({
      ticker: asset.ticker,
      assetClass: asset.assetClass,
      currency: asset.currency,
      categoryId: categoryByTicker.get(asset.ticker) ?? UNCATEGORIZED,
      traded: asset.traded,
    })),
  };
}

async function assignTickers(
  userId: string,
  tickers: readonly string[],
  categoryId: string | null,
): Promise<number> {
  const unique = [...new Set(tickers)];

  if (unique.length === 0) {
    return 0;
  }

  if (categoryId) {
    await ownedCategory(userId, categoryId);
  }

  const allowed = await knownTickers(userId);
  const unknown = unique.filter((ticker) => !allowed.has(ticker));

  if (unknown.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown ticker: ${unknown[0]}`,
    });
  }

  if (categoryId === null) {
    await db
      .delete(assetCategories)
      .where(
        and(
          eq(assetCategories.userId, userId),
          inArray(assetCategories.ticker, unique),
        ),
      );

    return unique.length;
  }

  const now = new Date();

  await db
    .insert(assetCategories)
    .values(
      unique.map((ticker) => ({
        userId,
        ticker,
        categoryId,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [assetCategories.userId, assetCategories.ticker],
      set: {
        categoryId,
        updatedAt: sql`now()`,
      },
    });

  return unique.length;
}

export const categoriesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listPayload(ctx.user.id)),

  create: protectedProcedure
    .input(createCategoryInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await loadCategories(ctx.user.id);

      if (categoryNameTaken(input.name, existing)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A category with this name already exists",
        });
      }

      const [row] = await db
        .insert(categories)
        .values({
          userId: ctx.user.id,
          name: input.name,
          color: input.color ?? nextCategoryColor(existing.length),
          sortOrder: await nextSortOrder(ctx.user.id),
        })
        .returning({ id: categories.id });

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      return listPayload(ctx.user.id);
    }),

  update: protectedProcedure
    .input(updateCategoryInput)
    .mutation(async ({ ctx, input }) => {
      await ownedCategory(ctx.user.id, input.id);

      if (input.name) {
        const existing = await loadCategories(ctx.user.id);

        if (categoryNameTaken(input.name, existing, input.id)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A category with this name already exists",
          });
        }
      }

      const patch: {
        name?: string;
        color?: CategoryColor;
        updatedAt: Date;
      } = { updatedAt: new Date() };

      if (input.name !== undefined) {
        patch.name = input.name;
      }

      if (input.color !== undefined) {
        patch.color = input.color;
      }

      await db
        .update(categories)
        .set(patch)
        .where(
          and(eq(categories.userId, ctx.user.id), eq(categories.id, input.id)),
        );

      return listPayload(ctx.user.id);
    }),

  remove: protectedProcedure
    .input(deleteCategoryInput)
    .mutation(async ({ ctx, input }) => {
      await ownedCategory(ctx.user.id, input.id);

      await db
        .delete(categories)
        .where(
          and(eq(categories.userId, ctx.user.id), eq(categories.id, input.id)),
        );

      return listPayload(ctx.user.id);
    }),

  assign: protectedProcedure
    .input(assignCategoryInput)
    .mutation(async ({ ctx, input }) => {
      await assignTickers(ctx.user.id, [input.ticker], input.categoryId);

      return listPayload(ctx.user.id);
    }),

  assignMany: protectedProcedure
    .input(assignManyCategoriesInput)
    .mutation(async ({ ctx, input }) => {
      await assignTickers(ctx.user.id, input.tickers, input.categoryId);

      return listPayload(ctx.user.id);
    }),
});
