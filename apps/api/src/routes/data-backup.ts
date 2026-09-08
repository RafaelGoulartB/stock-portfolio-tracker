import { randomUUID } from "node:crypto";
import { CompressionStream, DecompressionStream } from "node:stream/web";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, sql } from "../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  cashBalances,
  categories,
  transactions,
  userContributionPlanConfigs,
  userScoreConfigs,
} from "../db/schema";
import { assertBackupTransactionsValid } from "../domain/backup-validation";
import {
  BACKUP_ENTITIES,
  BACKUP_FORMAT,
  BACKUP_MEDIA_TYPE,
  BACKUP_VERSION,
  type BackupEntity,
  type BackupManifest,
  type BackupRecord,
  backupRecordSchema,
  checksumSchema,
  createBackupHash,
  decodeLines,
  emptyBackupCounts,
  encodeBackupLine,
  MAX_COMPRESSED_BYTES,
  MAX_RECORDS,
  manifestSchema,
} from "../lib/data-backup";
import { createContext } from "../trpc/context";

const encoder = new TextEncoder();
const BATCH_SIZE = 500;
type ByteTransform = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

function jsonError(message: string, status: 400 | 401 | 409 | 413 | 500) {
  return Response.json({ error: message }, { status });
}

/**
 * Caps the raw request body at `maxBytes` before it reaches the decompressor,
 * so an oversized compressed upload is rejected without buffering it. This is
 * the outer bound; `decodeLines` separately caps the inflated payload.
 */
function limitStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  let seen = 0;
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      seen += value.byteLength;
      if (seen > maxBytes) {
        controller.error(
          new Error(`Backup exceeds the ${maxBytes}-byte upload limit`),
        );
        await reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function toWebStream(iterator: AsyncGenerator<string>) {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

function serializeRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key === "createdAt" || key === "updatedAt"
        ? new Date(value as string | Date).toISOString()
        : value,
    ]),
  );
}

async function* exportBackup(userId: string): AsyncGenerator<string> {
  const connection = await sql.reserve();
  let completed = false;

  try {
    await connection`begin transaction isolation level repeatable read read only`;

    const counts = emptyBackupCounts();
    for (const entity of BACKUP_ENTITIES) {
      const tableName =
        entity === "allocationAssets"
          ? "allocation_assets"
          : entity === "cashBalances"
            ? "cash_balances"
            : entity === "assetReviews"
              ? "asset_reviews"
              : entity === "assetCategories"
                ? "asset_categories"
                : entity === "scoreConfigs"
                  ? "user_score_configs"
                  : entity === "contributionPlanConfigs"
                    ? "user_contribution_plan_configs"
                    : entity;
      const [result] = await connection`
        select count(*)::text as value
        from ${connection(tableName)}
        where user_id = ${userId}
      `;
      counts[entity] = Number(result?.value ?? 0);
    }

    const manifest: BackupManifest = {
      type: "manifest",
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      counts,
    };
    const hash = createBackupHash();
    const emit = (value: unknown) => {
      const line = encodeBackupLine(value);
      hash.update(line);
      return line;
    };

    yield emit(manifest);

    for await (const rows of connection`
      select id as ref, name, color, sort_order as "sortOrder",
        created_at as "createdAt", updated_at as "updatedAt"
      from categories where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "categories",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select ticker, asset_class as "assetClass", currency,
        target_weight as "targetWeight", valuation_ref as "valuationRef",
        manual_price as "manualPrice", sort_order as "sortOrder",
        mark_color as "markColor",
        created_at as "createdAt", updated_at as "updatedAt"
      from allocation_assets where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "allocationAssets",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select amount, updated_at as "updatedAt"
      from cash_balances where user_id = ${userId} order by user_id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "cashBalances",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select ticker, period, grade, notes, fair_value as "fairValue",
        fair_value_ref as "fairValueRef", watch_next as "watchNext",
        created_at as "createdAt", updated_at as "updatedAt"
      from asset_reviews where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "assetReviews",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select ticker, asset_class as "assetClass", currency, side, quantity,
        price, fees, traded_at as "tradedAt", notes, created_at as "createdAt"
      from transactions where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "transactions",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select ac.ticker, ac.category_id as "categoryRef",
        ac.created_at as "createdAt", ac.updated_at as "updatedAt"
      from asset_categories ac
      where ac.user_id = ${userId}
      order by ac.id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "assetCategories",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select version, absolute_weight_cap as "absoluteWeightCap",
        overweight_block_factor as "overweightBlockFactor",
        trim_factor as "trimFactor", cooldown_days as "cooldownDays",
        grade_window_quarters as "gradeWindowQuarters",
        grade_bands as "gradeBands",
        ungraded_multiplier as "ungradedMultiplier",
        updated_at as "updatedAt"
      from user_score_configs where user_id = ${userId} order by user_id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "scoreConfigs",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select version, small_book_impact as "smallBookImpact",
        large_book_impact as "largeBookImpact",
        max_share as "maxShare", max_assets as "maxAssets",
        updated_at as "updatedAt"
      from user_contribution_plan_configs where user_id = ${userId}
      order by user_id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "contributionPlanConfigs",
          data: serializeRow(data),
        });
      }
    }

    yield encodeBackupLine({
      type: "checksum",
      algorithm: "sha256",
      value: hash.digest("hex"),
    });
    await connection`commit`;
    completed = true;
  } finally {
    if (!completed) {
      await connection`rollback`.catch(() => undefined);
    }
    await connection.release();
  }
}

type RecordData<E extends BackupEntity> = Extract<
  BackupRecord,
  { entity: E }
>["data"];

type ParsedBackup = {
  manifest: BackupManifest;
  counts: ReturnType<typeof emptyBackupCounts>;
  categories: RecordData<"categories">[];
  allocationAssets: RecordData<"allocationAssets">[];
  cashBalances: RecordData<"cashBalances">[];
  assetReviews: RecordData<"assetReviews">[];
  transactions: RecordData<"transactions">[];
  assetCategories: RecordData<"assetCategories">[];
  scoreConfigs: RecordData<"scoreConfigs">[];
  contributionPlanConfigs: RecordData<"contributionPlanConfigs">[];
};

/**
 * Phase one: decode, verify, and buffer the whole upload without touching the
 * database. Reading an untrusted, network-paced stream must not hold the
 * replacement transaction open, so every integrity check — checksum, counts,
 * record order, decimal precision, and the financial invariants — runs here
 * first. `decodeLines` bounds the decompressed bytes, line size, and line
 * count, and `MAX_RECORDS` bounds the buffer, so this stays on a fixed budget.
 */
async function parseBackup(
  body: ReadableStream<Uint8Array>,
): Promise<ParsedBackup> {
  const decompressed = body.pipeThrough(
    new DecompressionStream("gzip") as unknown as ByteTransform,
  );
  const iterator = decodeLines(decompressed)[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done || first.value.length === 0) {
    throw new Error("Backup is empty");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(first.value);
  } catch {
    throw new Error("Backup manifest is not valid JSON");
  }
  const manifest = manifestSchema.parse(parsedJson);
  const hash = createBackupHash();
  hash.update(`${first.value}\n`);

  const parsed: ParsedBackup = {
    manifest,
    counts: emptyBackupCounts(),
    categories: [],
    allocationAssets: [],
    cashBalances: [],
    assetReviews: [],
    transactions: [],
    assetCategories: [],
    scoreConfigs: [],
    contributionPlanConfigs: [],
  };
  let lastEntityIndex = 0;
  let totalRecords = 0;
  let sawChecksum = false;

  for await (const line of { [Symbol.asyncIterator]: () => iterator }) {
    if (line.length === 0) continue;
    if (sawChecksum) throw new Error("Backup has data after its checksum");

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error("Backup contains invalid JSON");
    }

    const checksum = checksumSchema.safeParse(value);
    if (checksum.success) {
      const digest = hash.digest("hex");
      if (digest !== checksum.data.value) {
        throw new Error("Backup checksum does not match its contents");
      }
      for (const entity of BACKUP_ENTITIES) {
        if (parsed.counts[entity] !== manifest.counts[entity]) {
          throw new Error(`Backup row count does not match for ${entity}`);
        }
      }
      sawChecksum = true;
      continue;
    }

    const record = backupRecordSchema.parse(value);
    const entityIndex = BACKUP_ENTITIES.indexOf(record.entity);
    if (entityIndex < lastEntityIndex) {
      throw new Error("Backup records are not in a supported order");
    }
    lastEntityIndex = entityIndex;
    hash.update(`${line}\n`);

    totalRecords += 1;
    if (totalRecords > MAX_RECORDS) {
      throw new Error(`Backup contains more than ${MAX_RECORDS} records`);
    }

    parsed.counts[record.entity] += 1;
    if (parsed.counts[record.entity] > manifest.counts[record.entity]) {
      throw new Error(`Backup has too many rows for ${record.entity}`);
    }

    switch (record.entity) {
      case "categories":
        parsed.categories.push(record.data);
        break;
      case "allocationAssets":
        parsed.allocationAssets.push(record.data);
        break;
      case "cashBalances":
        parsed.cashBalances.push(record.data);
        break;
      case "assetReviews":
        parsed.assetReviews.push(record.data);
        break;
      case "transactions":
        parsed.transactions.push(record.data);
        break;
      case "assetCategories":
        parsed.assetCategories.push(record.data);
        break;
      case "scoreConfigs":
        parsed.scoreConfigs.push(record.data);
        break;
      case "contributionPlanConfigs":
        parsed.contributionPlanConfigs.push(record.data);
        break;
    }
  }

  if (!sawChecksum) throw new Error("Backup checksum is missing");
  if (parsed.cashBalances.length > 1) {
    throw new Error("Backup contains more than one cash balance");
  }
  if (parsed.scoreConfigs.length > 1) {
    throw new Error("Backup contains more than one score config");
  }
  if (parsed.contributionPlanConfigs.length > 1) {
    throw new Error("Backup contains more than one contribution plan config");
  }

  // Replaying a backup must never smuggle in a state a live write would refuse.
  assertBackupTransactionsValid(parsed.transactions);

  return parsed;
}

/**
 * Phase two: replace the account atomically. The upload is already fully
 * decoded and validated, so this transaction only deletes and inserts bounded
 * batches and stays short.
 */
async function replaceAccountData(parsed: ParsedBackup, userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(assetCategories).where(eq(assetCategories.userId, userId));
    await tx.delete(assetReviews).where(eq(assetReviews.userId, userId));
    await tx
      .delete(allocationAssets)
      .where(eq(allocationAssets.userId, userId));
    await tx.delete(cashBalances).where(eq(cashBalances.userId, userId));
    await tx.delete(transactions).where(eq(transactions.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));
    await tx
      .delete(userScoreConfigs)
      .where(eq(userScoreConfigs.userId, userId));
    await tx
      .delete(userContributionPlanConfigs)
      .where(eq(userContributionPlanConfigs.userId, userId));

    const categoryIdByRef = new Map<string, string>();
    for (let index = 0; index < parsed.categories.length; index += BATCH_SIZE) {
      const values = parsed.categories
        .slice(index, index + BATCH_SIZE)
        .map(({ ref, ...row }) => {
          const id = randomUUID();
          categoryIdByRef.set(ref, id);
          return { ...row, id, userId };
        });
      await tx.insert(categories).values(values);
    }

    for (
      let index = 0;
      index < parsed.allocationAssets.length;
      index += BATCH_SIZE
    ) {
      await tx
        .insert(allocationAssets)
        .values(
          parsed.allocationAssets
            .slice(index, index + BATCH_SIZE)
            .map((row) => ({ ...row, userId })),
        );
    }

    if (parsed.cashBalances.length > 0) {
      await tx
        .insert(cashBalances)
        .values(parsed.cashBalances.map((row) => ({ ...row, userId })));
    }

    for (
      let index = 0;
      index < parsed.assetReviews.length;
      index += BATCH_SIZE
    ) {
      await tx
        .insert(assetReviews)
        .values(
          parsed.assetReviews
            .slice(index, index + BATCH_SIZE)
            .map((row) => ({ ...row, userId })),
        );
    }

    for (
      let index = 0;
      index < parsed.transactions.length;
      index += BATCH_SIZE
    ) {
      await tx
        .insert(transactions)
        .values(
          parsed.transactions
            .slice(index, index + BATCH_SIZE)
            .map((row) => ({ ...row, userId })),
        );
    }

    for (
      let index = 0;
      index < parsed.assetCategories.length;
      index += BATCH_SIZE
    ) {
      await tx.insert(assetCategories).values(
        parsed.assetCategories
          .slice(index, index + BATCH_SIZE)
          .map(({ categoryRef, ...row }) => {
            const categoryId = categoryIdByRef.get(categoryRef);
            if (!categoryId) {
              throw new Error("Backup contains a broken category reference");
            }
            return { ...row, categoryId, userId };
          }),
      );
    }

    if (parsed.scoreConfigs.length > 0) {
      await tx
        .insert(userScoreConfigs)
        .values(parsed.scoreConfigs.map((row) => ({ ...row, userId })));
    }

    if (parsed.contributionPlanConfigs.length > 0) {
      await tx
        .insert(userContributionPlanConfigs)
        .values(
          parsed.contributionPlanConfigs.map((row) => ({ ...row, userId })),
        );
    }
  });
}

async function importBackup(body: ReadableStream<Uint8Array>, userId: string) {
  const parsed = await parseBackup(body);
  await replaceAccountData(parsed, userId);
  return { imported: parsed.counts };
}

export const dataBackupRoutes = new Hono()
  .get("/export", async (c) => {
    const context = await createContext(c);
    if (!context.user) return jsonError("Sign in to continue", 401);

    const date = new Date().toISOString().slice(0, 10);
    const source = toWebStream(exportBackup(context.user.id));
    const compressed = source.pipeThrough(
      new CompressionStream("gzip") as unknown as ByteTransform,
    );

    return new Response(compressed, {
      headers: {
        "Content-Type": BACKUP_MEDIA_TYPE,
        "Content-Disposition": `attachment; filename="portifolio-backup-${date}.jsonl.gz"`,
        "Cache-Control": "no-store",
      },
    });
  })
  .post("/import", async (c) => {
    const context = await createContext(c);
    if (!context.user) return jsonError("Sign in to continue", 401);
    if (c.req.header("X-Backup-Confirmation") !== "REPLACE") {
      return jsonError("Explicit replacement confirmation is required", 409);
    }
    if (!c.req.header("Content-Type")?.startsWith(BACKUP_MEDIA_TYPE)) {
      return jsonError("Select a .jsonl.gz portfolio backup", 400);
    }
    const declaredLength = Number(c.req.header("Content-Length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_COMPRESSED_BYTES
    ) {
      return jsonError("Backup upload is too large", 413);
    }
    if (!c.req.raw.body) return jsonError("Backup is empty", 400);

    try {
      const bounded = limitStream(c.req.raw.body, MAX_COMPRESSED_BYTES);
      const result = await importBackup(bounded, context.user.id);
      return c.json(result);
    } catch (error) {
      console.error("Backup import failed", error);
      return jsonError(
        error instanceof Error ? error.message : "Backup import failed",
        400,
      );
    }
  });
