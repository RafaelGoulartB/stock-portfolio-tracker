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

    expect(manifest.version).toBe(11);
    if (record.entity !== "transactions") {
      throw new Error("expected transaction record");
    }
    expect(record.data.createdAt).toBeInstanceOf(Date);
    // A pre-v7 trade restores with its trade-date rate still unresolved.
    expect(record.data.usdBrlRate).toBeNull();
    // A pre-v11 trade was never imported from a broker note.
    expect(record.data.brokerNoteRef).toBeNull();
  });

  it("accepts a v11 broker note and defaults note counts for older manifests", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "brokerNotes",
      data: {
        ref: "4f1f8a5e-7d0c-4f43-9a55-2c6a0e1d9b10",
        format: "inter-dtvm-sinacor",
        fingerprint: "a".repeat(64),
        fileName: "nota.pdf",
        fileSha256: "b".repeat(64),
        noteNumber: null,
        account: "999",
        tradeDate: "2026-09-01",
        settlementDate: "2026-09-03",
        currency: "BRL",
        purchasesTotal: "2645.20000000",
        salesTotal: "0.00000000",
        feesTotal: "0.78000000",
        withheldTax: "0.00000000",
        netAmount: "-2645.98000000",
        details: { version: 1, fees: [], withheldTaxBase: null, lines: [] },
        createdAt: "2026-09-02T12:00:00.000Z",
      },
    });

    expect(record.entity).toBe("brokerNotes");
    expect(
      manifestSchema.parse({
        type: "manifest",
        format: BACKUP_FORMAT,
        version: 10,
        exportedAt: "2026-09-06T20:00:00.000Z",
        counts: {
          categories: 0,
          allocationAssets: 0,
          assetReviews: 0,
          transactions: 0,
          assetCategories: 0,
        },
      }).counts,
    ).toMatchObject({ brokerNotes: 0, brokerSecurityAliases: 0 });
  });

  it("accepts a v8 split record and defaults its count for older manifests", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "corporateActions",
      data: {
        ticker: "PETR4",
        kind: "split",
        effectiveAt: "2026-03-01",
        fromQuantity: "1.00000000",
        toQuantity: "2.00000000",
        notes: null,
        createdAt: "2026-03-01T12:00:00.000Z",
      },
    });

    expect(record.entity).toBe("corporateActions");
    expect(() =>
      backupRecordSchema.parse({
        type: "record",
        entity: "corporateActions",
        data: {
          ticker: "PETR4",
          kind: "split",
          effectiveAt: "2026-03-01",
          fromQuantity: "2",
          toQuantity: "2",
          notes: null,
          createdAt: "2026-03-01T12:00:00.000Z",
        },
      }),
    ).toThrow();
    expect(
      manifestSchema.parse({
        type: "manifest",
        format: BACKUP_FORMAT,
        version: 7,
        exportedAt: "2026-09-06T20:00:00.000Z",
        counts: {
          categories: 0,
          allocationAssets: 0,
          assetReviews: 0,
          transactions: 0,
          assetCategories: 0,
        },
      }).counts.corporateActions,
    ).toBe(0);
  });

  it("round-trips a trade-date USD/BRL and rejects a zero rate", () => {
    const trade = {
      ticker: "COST",
      assetClass: "stock_us",
      currency: "USD",
      side: "buy",
      quantity: "2.00000000",
      price: "900.00000000",
      fees: "0.00000000",
      tradedAt: "2025-01-20",
      notes: null,
      createdAt: "2025-01-20T12:00:00.000Z",
    };
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "transactions",
      data: { ...trade, usdBrlRate: "6.10420000" },
    });

    expect(record.entity === "transactions" && record.data.usdBrlRate).toBe(
      "6.10420000",
    );
    expect(() =>
      backupRecordSchema.parse({
        type: "record",
        entity: "transactions",
        data: { ...trade, usdBrlRate: "0" },
      }),
    ).toThrow();
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
    // A v8 planner record predates the starter fraction.
    expect(record.data.starterFraction).toBe("0.5");
  });

  it("maps a v2 score config onto the v3 policy", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "scoreConfigs",
      data: {
        version: "custom",
        absoluteWeightCap: "0.05000000",
        overweightBlockFactor: "1.30000000",
        trimAbsoluteBand: "0.05000000",
        trimRelativeBand: "0.25000000",
        cooldownDays: 45,
        cooldownFloor: "0.25000000",
        gradeWindowQuarters: 4,
        gradeHalfLifeQuarters: 4,
        gradePriorQuarters: "1.00000000",
        gradeBands: [{ minGrade: "0", multiplier: "1" }],
        ungradedMultiplier: "1.00000000",
        valuationDeadZone: "0.05000000",
        valuationSensitivity: "1.00000000",
        tiltMin: "0.50000000",
        tiltMax: "1.50000000",
        fairValueHalfLifeQuarters: 2,
        updatedAt: "2026-09-26T12:00:00.000Z",
      },
    });

    if (record.entity !== "scoreConfigs") {
      throw new Error("expected score config record");
    }
    // The user's v2 knobs survive; only the v3 knobs take defaults.
    expect(record.data).toMatchObject({
      overweightBlockFactor: "1.30000000",
      valuationSensitivity: "1.00000000",
      icReference: "0.10",
      icPrior: "0.05",
      icPriorPairs: 240,
      momentumWeight: "0.10",
      sellConfidence: "0.8",
    });
  });

  const v3Policy = {
    version: "custom",
    absoluteWeightCap: "0.05000000",
    overweightBlockFactor: "2.00000000",
    trimAbsoluteBand: "0.05000000",
    trimRelativeBand: "0.25000000",
    cooldownDays: 45,
    cooldownFloor: "0.25000000",
    gradeWindowQuarters: 4,
    gradeHalfLifeQuarters: 4,
    gradePriorQuarters: "1.00000000",
    gradeBands: [{ minGrade: "0", multiplier: "1" }],
    ungradedMultiplier: "1.00000000",
    valuationDeadZone: "0.00000000",
    valuationSensitivity: "3.00000000",
    tiltMin: "0.20000000",
    tiltMax: "3.00000000",
    fairValueHalfLifeQuarters: 2,
    icReference: "0.10000000",
    icPrior: "0.05000000",
    icPriorPairs: 240,
    momentumWeight: "0.10000000",
    momentumZCap: "2.00000000",
    reviewDrift: "0.25000000",
    sellBand: "0.25000000",
    sellConfidence: "0.80000000",
    updatedAt: "2026-09-27T12:00:00.000Z",
  };

  it("keeps every knob of a v3 score config", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "scoreConfigs",
      data: v3Policy,
    });

    if (record.entity !== "scoreConfigs") {
      throw new Error("expected score config record");
    }
    expect(record.data).toMatchObject({
      icReference: "0.10000000",
      icPriorPairs: 240,
      momentumZCap: "2.00000000",
      sellConfidence: "0.80000000",
    });
  });

  it("rejects a score config the engine could not load", () => {
    for (const broken of [
      { icReference: "0" },
      { momentumWeight: "30" },
      { sellConfidence: "1.5" },
    ]) {
      expect(() =>
        backupRecordSchema.parse({
          type: "record",
          entity: "scoreConfigs",
          data: { ...v3Policy, ...broken },
        }),
      ).toThrow();
    }
  });

  it("maps a v1 score config onto the v2 policy", () => {
    const record = backupRecordSchema.parse({
      type: "record",
      entity: "scoreConfigs",
      data: {
        version: "custom",
        absoluteWeightCap: "0.06000000",
        overweightBlockFactor: "1.30000000",
        trimFactor: "1.40000000",
        cooldownDays: 30,
        gradeWindowQuarters: 4,
        gradeBands: [{ minGrade: "0", multiplier: "1" }],
        ungradedMultiplier: "1.00000000",
        updatedAt: "2026-09-07T12:00:00.000Z",
      },
    });

    if (record.entity !== "scoreConfigs") {
      throw new Error("expected score config record");
    }
    expect(record.data).toMatchObject({
      absoluteWeightCap: "0.06000000",
      trimRelativeBand: "0.40000000",
      trimAbsoluteBand: "0.05",
      cooldownDays: 30,
      cooldownFloor: "0.25",
      valuationDeadZone: "0",
      momentumWeight: "0.10",
      fairValueHalfLifeQuarters: 2,
    });
    expect("trimFactor" in record.data).toBe(false);
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
