import { randomUUID } from "node:crypto";
import { CompressionStream, DecompressionStream } from "node:stream/web";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, sql } from "../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  categories,
  transactions,
} from "../db/schema";
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
  manifestSchema,
} from "../lib/data-backup";
import { createContext } from "../trpc/context";

const encoder = new TextEncoder();
const BATCH_SIZE = 500;
type ByteTransform = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

function jsonError(message: string, status: 400 | 401 | 409 | 500) {
  return Response.json({ error: message }, { status });
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
          : entity === "assetReviews"
            ? "asset_reviews"
            : entity === "assetCategories"
              ? "asset_categories"
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
      select ticker, period, grade, notes, fair_value as "fairValue",
        fair_value_ref as "fairValueRef", created_at as "createdAt",
        updated_at as "updatedAt"
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

async function importBackup(body: ReadableStream<Uint8Array>, userId: string) {
  const decompressed = body.pipeThrough(
    new DecompressionStream("gzip") as unknown as ByteTransform,
  );
  const lines = decodeLines(decompressed);
  const iterator = lines[Symbol.asyncIterator]();
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
  const actualCounts = emptyBackupCounts();
  let lastEntityIndex = 0;
  let sawChecksum = false;

  await db.transaction(async (tx) => {
    await tx.delete(assetCategories).where(eq(assetCategories.userId, userId));
    await tx.delete(assetReviews).where(eq(assetReviews.userId, userId));
    await tx
      .delete(allocationAssets)
      .where(eq(allocationAssets.userId, userId));
    await tx.delete(transactions).where(eq(transactions.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));

    const categoryIdByRef = new Map<string, string>();
    let categoryBatch: RecordData<"categories">[] = [];
    let allocationBatch: RecordData<"allocationAssets">[] = [];
    let reviewBatch: RecordData<"assetReviews">[] = [];
    let transactionBatch: RecordData<"transactions">[] = [];
    let assignmentBatch: RecordData<"assetCategories">[] = [];

    const flush = async (entity: BackupEntity) => {
      if (entity === "categories" && categoryBatch.length > 0) {
        const values = categoryBatch.map(({ ref, ...row }) => {
          const id = randomUUID();
          categoryIdByRef.set(ref, id);
          return { ...row, id, userId };
        });
        await tx.insert(categories).values(values);
        categoryBatch = [];
      } else if (entity === "allocationAssets" && allocationBatch.length > 0) {
        await tx
          .insert(allocationAssets)
          .values(allocationBatch.map((row) => ({ ...row, userId })));
        allocationBatch = [];
      } else if (entity === "assetReviews" && reviewBatch.length > 0) {
        await tx
          .insert(assetReviews)
          .values(reviewBatch.map((row) => ({ ...row, userId })));
        reviewBatch = [];
      } else if (entity === "transactions" && transactionBatch.length > 0) {
        await tx
          .insert(transactions)
          .values(transactionBatch.map((row) => ({ ...row, userId })));
        transactionBatch = [];
      } else if (entity === "assetCategories" && assignmentBatch.length > 0) {
        await tx.insert(assetCategories).values(
          assignmentBatch.map(({ categoryRef, ...row }) => {
            const categoryId = categoryIdByRef.get(categoryRef);
            if (!categoryId) {
              throw new Error("Backup contains a broken category reference");
            }
            return { ...row, categoryId, userId };
          }),
        );
        assignmentBatch = [];
      }
    };

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
        for (const entity of BACKUP_ENTITIES) await flush(entity);
        const digest = hash.digest("hex");
        if (digest !== checksum.data.value) {
          throw new Error("Backup checksum does not match its contents");
        }
        for (const entity of BACKUP_ENTITIES) {
          if (actualCounts[entity] !== manifest.counts[entity]) {
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
      actualCounts[record.entity] += 1;
      if (actualCounts[record.entity] > manifest.counts[record.entity]) {
        throw new Error(`Backup has too many rows for ${record.entity}`);
      }

      switch (record.entity) {
        case "categories":
          categoryBatch.push(record.data);
          if (categoryBatch.length >= BATCH_SIZE) await flush(record.entity);
          break;
        case "allocationAssets":
          allocationBatch.push(record.data);
          if (allocationBatch.length >= BATCH_SIZE) await flush(record.entity);
          break;
        case "assetReviews":
          reviewBatch.push(record.data);
          if (reviewBatch.length >= BATCH_SIZE) await flush(record.entity);
          break;
        case "transactions":
          transactionBatch.push(record.data);
          if (transactionBatch.length >= BATCH_SIZE) await flush(record.entity);
          break;
        case "assetCategories":
          assignmentBatch.push(record.data);
          if (assignmentBatch.length >= BATCH_SIZE) await flush(record.entity);
          break;
      }
    }

    if (!sawChecksum) throw new Error("Backup checksum is missing");
  });

  return { imported: actualCounts };
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
    if (!c.req.raw.body) return jsonError("Backup is empty", 400);

    try {
      const result = await importBackup(c.req.raw.body, context.user.id);
      return c.json(result);
    } catch (error) {
      console.error("Backup import failed", error);
      return jsonError(
        error instanceof Error ? error.message : "Backup import failed",
        400,
      );
    }
  });
