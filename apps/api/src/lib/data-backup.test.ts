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

    expect(manifest.version).toBe(6);
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
    expect(manifest.counts.contributionPlanConfigs).toBe(0);
  });

  it("hashes the exact newline-delimited representation", () => {
    const line = encodeBackupLine({ type: "manifest", version: 1 });
    const hash = createBackupHash().update(line).digest("hex");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(createBackupHash().update(line).digest("hex"));
  });

  it("keeps contribution plan knobs as decimal strings", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "contributionPlanConfigs",
      data: {
        version: "custom",
        smallBookImpact: "0.02000000",
        largeBookImpact: "0.00500000",
        maxShare: "0.70000000",
        maxAssets: 5,
        updatedAt: "2026-09-07T12:00:00.000Z",
      },
    });

    if (record.entity !== "contributionPlanConfigs") {
      throw new Error("expected contribution plan config record");
    }
    expect(record.data.smallBookImpact).toBe("0.02000000");
    expect(record.data.largeBookImpact).toBe("0.00500000");
    expect(record.data.maxShare).toBe("0.70000000");
    expect(record.data.maxAssets).toBe(5);
  });

  it("defaults a missing review watchNext flag on older backups", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "assetReviews",
      data: {
        ticker: "DLO",
        period: "2026Q1",
        grade: "8",
        notes: null,
        fairValue: "100",
        fairValueRef: null,
        createdAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    });

    if (record.entity !== "assetReviews") {
      throw new Error("expected asset review record");
    }
    expect(record.data.watchNext).toBe(false);
  });

  it("keeps an explicit review watchNext flag", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "assetReviews",
      data: {
        ticker: "DLO",
        period: "2026Q1",
        grade: "8",
        notes: null,
        fairValue: "100",
        fairValueRef: null,
        watchNext: true,
        createdAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    });

    if (record.entity !== "assetReviews") {
      throw new Error("expected asset review record");
    }
    expect(record.data.watchNext).toBe(true);
  });

  it("maps a v4 planner record with a single impact onto the two book knobs", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "contributionPlanConfigs",
      data: {
        version: "custom",
        minWeightImpact: "0.00250000",
        maxShare: "0.70000000",
        maxAssets: 5,
        updatedAt: "2026-09-07T12:00:00.000Z",
      },
    });

    if (record.entity !== "contributionPlanConfigs") {
      throw new Error("expected contribution plan config record");
    }
    expect(record.data.smallBookImpact).toBe("0.02");
    expect(record.data.largeBookImpact).toBe("0.005");
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

  it("rejects a decimal beyond numeric(22, 8) integer digits", () => {
    expect(() =>
      backupRecordSchema.parse({
        type: "record",
        entity: "cashBalances",
        data: {
          // 15 integer digits exceeds the 14 the column can store.
          amount: "123456789012345.00",
          updatedAt: "2026-09-07T12:00:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("rejects a decimal with more than 8 fractional digits", () => {
    expect(() =>
      backupRecordSchema.parse({
        type: "record",
        entity: "cashBalances",
        data: {
          amount: "1.000000009",
          updatedAt: "2026-09-07T12:00:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("rejects a non-positive traded quantity", () => {
    for (const quantity of ["0", "-1"]) {
      expect(() =>
        backupRecordSchema.parse({
          type: "record",
          entity: "transactions",
          data: {
            ticker: "PETR4",
            assetClass: "stock_br",
            currency: "BRL",
            side: "buy",
            quantity,
            price: "25.5",
            fees: "0",
            tradedAt: "2026-09-01",
            notes: null,
            createdAt: "2026-09-01T12:00:00.000Z",
          },
        }),
      ).toThrow();
    }
  });

  it("rejects a non-positive traded price", () => {
    expect(() =>
      backupRecordSchema.parse({
        type: "record",
        entity: "transactions",
        data: {
          ticker: "PETR4",
          assetClass: "stock_br",
          currency: "BRL",
          side: "buy",
          quantity: "10",
          price: "0",
          fees: "0",
          tradedAt: "2026-09-01",
          notes: null,
          createdAt: "2026-09-01T12:00:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("still accepts zero fees on a transaction", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "transactions",
      data: {
        ticker: "PETR4",
        assetClass: "stock_br",
        currency: "BRL",
        side: "buy",
        quantity: "10",
        price: "25.5",
        fees: "0",
        tradedAt: "2026-09-01",
        notes: null,
        createdAt: "2026-09-01T12:00:00.000Z",
      },
    });
    if (record.entity !== "transactions") {
      throw new Error("expected transaction record");
    }
    expect(record.data.fees).toBe("0");
  });

  it("accepts a negative cash balance as a signed decimal", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "cashBalances",
      data: { amount: "-10.50000000", updatedAt: "2026-09-07T12:00:00.000Z" },
    });
    if (record.entity !== "cashBalances") {
      throw new Error("expected cash balance record");
    }
    expect(record.data.amount).toBe("-10.50000000");
  });

  it("rejects a payload past the decompressed byte budget", async () => {
    const chunk = "x".repeat(1024);
    async function consume() {
      for await (const _ of decodeLines(byteStream(chunk, chunk, chunk), {
        maxTotalBytes: 2048,
        maxLineBytes: 1024 * 1024,
      })) {
        // drain
      }
    }
    await expect(consume()).rejects.toThrow(/decompressed limit/i);
  });

  it("rejects more lines than the configured maximum", async () => {
    async function consume() {
      for await (const _ of decodeLines(byteStream("a\n", "b\n", "c\n"), {
        maxLines: 2,
      })) {
        // drain
      }
    }
    await expect(consume()).rejects.toThrow(/more than 2 lines/i);
  });

  it("rejects a single line past the byte budget", async () => {
    async function consume() {
      for await (const _ of decodeLines(byteStream("x".repeat(50), "\n"), {
        maxLineBytes: 16,
      })) {
        // drain
      }
    }
    await expect(consume()).rejects.toThrow(/larger than 16 bytes/i);
  });
});
