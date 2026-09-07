import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupRecordSchema,
  createBackupHash,
  decodeLines,
  emptyBackupCounts,
  encodeBackupLine,
  manifestSchema,
} from "./data-backup";

function byteStream(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("portable data backups", () => {
  it("decodes lines across arbitrary stream chunks", async () => {
    const lines: string[] = [];
    for await (const line of decodeLines(byteStream('{"a":', "1}\n", "last"))) {
      lines.push(line);
    }
    expect(lines).toEqual(['{"a":1}', "last"]);
  });

  it("accepts the current manifest and transforms record timestamps", () => {
    const manifest = manifestSchema.parse({
      type: "manifest",
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: "2026-09-06T20:00:00.000Z",
      counts: emptyBackupCounts(),
    });
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "transactions",
      data: {
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10.00000000",
        price: "25.50000000",
        fees: "0.00000000",
        tradedAt: "2026-09-01",
        notes: null,
        createdAt: "2026-09-01T12:00:00.000Z",
      },
    });

    expect(manifest.version).toBe(3);
    if (record.entity !== "transactions") {
      throw new Error("expected transaction record");
    }
    expect(record.data.createdAt).toBeInstanceOf(Date);
  });

  it("accepts a v1 manifest without scoreConfigs and defaults the count", () => {
    const manifest = manifestSchema.parse({
      type: "manifest",
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: "2026-09-06T20:00:00.000Z",
      counts: {
        categories: 0,
        allocationAssets: 0,
        assetReviews: 0,
        transactions: 0,
        assetCategories: 0,
      },
    });

    expect(manifest.counts.scoreConfigs).toBe(0);
    expect(manifest.counts.cashBalances).toBe(0);
  });

  it("hashes the exact newline-delimited representation", () => {
    const line = encodeBackupLine({ type: "manifest", version: 1 });
    const hash = createBackupHash().update(line).digest("hex");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(createBackupHash().update(line).digest("hex"));
  });

  it("keeps the cash balance as an exact decimal string", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "cashBalances",
      data: {
        amount: "12345.67890000",
        updatedAt: "2026-09-07T12:00:00.000Z",
      },
    });

    if (record.entity !== "cashBalances") {
      throw new Error("expected cash balance record");
    }
    expect(record.data.amount).toBe("12345.67890000");
  });

  it("rejects decimal numbers that would lose database precision", () => {
    expect(() =>
      backupRecordSchema.parse({
        type: "record",
        entity: "transactions",
        data: {
          ticker: "PETR4",
          assetClass: "stock_br",
          currency: "BRL",
          side: "buy",
          quantity: 10,
          price: "25.5",
          fees: "0",
          tradedAt: "2026-09-01",
          notes: null,
          createdAt: "2026-09-01T12:00:00.000Z",
        },
      }),
    ).toThrow();
  });
});
