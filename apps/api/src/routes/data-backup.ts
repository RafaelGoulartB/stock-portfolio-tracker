import { randomUUID } from "node:crypto";
import { CompressionStream, DecompressionStream } from "node:stream/web";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, sql } from "../db";
import {
  allocationAssets,
  assetCategories,
  assetReviews,
  assetTaxProfiles,
  brokerNotes,
  brokerSecurityAliases,
  cashBalances,
  categories,
  corporateActions,
  darfPayments,
  financialGoals,
  foreignCashBalances,
  incomeTaxSettings,
  transactions,
  userContributionPlanConfigs,
  userScoreConfigs,
} from "../db/schema";
import {
  assertBackupBrokerNotesValid,
  assertBackupTransactionsValid,
} from "../domain/backup-validation";
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

const BACKUP_TABLES: Record<BackupEntity, string> = {
  categories: "categories",
  allocationAssets: "allocation_assets",
  cashBalances: "cash_balances",
  assetReviews: "asset_reviews",
  brokerNotes: "broker_notes",
  transactions: "transactions",
  corporateActions: "corporate_actions",
  assetCategories: "asset_categories",
  scoreConfigs: "user_score_configs",
  contributionPlanConfigs: "user_contribution_plan_configs",
  brokerSecurityAliases: "broker_security_aliases",
  incomeTaxSettings: "income_tax_settings",
  darfPayments: "darf_payments",
  assetTaxProfiles: "asset_tax_profiles",
  foreignCashBalances: "foreign_cash_balances",
  financialGoals: "financial_goals",
};

async function* exportBackup(userId: string): AsyncGenerator<string> {
  const connection = await sql.reserve();
  let completed = false;

  try {
    await connection`begin transaction isolation level repeatable read read only`;

    const counts = emptyBackupCounts();
    for (const entity of BACKUP_ENTITIES) {
      const tableName = BACKUP_TABLES[entity];
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
      select id as ref, format, fingerprint, file_name as "fileName",
        file_sha256 as "fileSha256", note_number as "noteNumber", account,
        trade_date as "tradeDate", settlement_date as "settlementDate",
        currency, purchases_total as "purchasesTotal",
        sales_total as "salesTotal", fees_total as "feesTotal",
        withheld_tax as "withheldTax",
        day_trade_withheld_tax as "dayTradeWithheldTax",
        net_amount as "netAmount", details,
        created_at as "createdAt"
      from broker_notes where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "brokerNotes",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select ticker, asset_class as "assetClass", currency, side, quantity,
        price, fees, traded_at as "tradedAt", usd_brl_rate as "usdBrlRate",
        notes, broker_note_id as "brokerNoteRef", created_at as "createdAt"
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
      select ticker, kind, effective_at as "effectiveAt",
        from_quantity as "fromQuantity", to_quantity as "toQuantity",
        unit_cost as "unitCost", notes,
        created_at as "createdAt"
      from corporate_actions where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "corporateActions",
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
        trim_absolute_band as "trimAbsoluteBand",
        trim_relative_band as "trimRelativeBand",
        cooldown_days as "cooldownDays", cooldown_floor as "cooldownFloor",
        grade_window_quarters as "gradeWindowQuarters",
        grade_half_life_quarters as "gradeHalfLifeQuarters",
        grade_prior_quarters as "gradePriorQuarters",
        grade_bands as "gradeBands",
        ungraded_multiplier as "ungradedMultiplier",
        valuation_dead_zone as "valuationDeadZone",
        valuation_sensitivity as "valuationSensitivity",
        tilt_min as "tiltMin", tilt_max as "tiltMax",
        fair_value_half_life_quarters as "fairValueHalfLifeQuarters",
        ic_reference as "icReference", ic_prior as "icPrior",
        ic_prior_pairs as "icPriorPairs",
        momentum_weight as "momentumWeight",
        momentum_z_cap as "momentumZCap", review_drift as "reviewDrift",
        sell_band as "sellBand", sell_confidence as "sellConfidence",
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
        starter_fraction as "starterFraction",
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

    for await (const rows of connection`
      select source_key as "sourceKey", ticker,
        created_at as "createdAt", updated_at as "updatedAt"
      from broker_security_aliases where user_id = ${userId} order by id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "brokerSecurityAliases",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select start_year as "startYear", ordinary_loss as "ordinaryLoss",
        day_trade_loss as "dayTradeLoss", fii_loss as "fiiLoss",
        foreign_loss as "foreignLoss", pending_darf as "pendingDarf",
        updated_at as "updatedAt"
      from income_tax_settings where user_id = ${userId} order by user_id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "incomeTaxSettings",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select month, paid_on as "paidOn", amount,
        created_at as "createdAt", updated_at as "updatedAt"
      from darf_payments where user_id = ${userId} order by month
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "darfPayments",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select ticker, legal_name as "legalName", cnpj, broker,
        created_at as "createdAt", updated_at as "updatedAt"
      from asset_tax_profiles where user_id = ${userId} order by ticker
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "assetTaxProfiles",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select year, amount_usd as "amountUsd", value_brl as "valueBrl",
        institution, updated_at as "updatedAt"
      from foreign_cash_balances where user_id = ${userId} order by year
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "foreignCashBalances",
          data: serializeRow(data),
        });
      }
    }

    for await (const rows of connection`
      select currency, monthly_contribution as "monthlyContribution",
        target_kind as "targetKind", target_amount as "targetAmount",
        withdrawal_rate as "withdrawalRate",
        conservative_return as "conservativeReturn",
        base_return as "baseReturn", optimistic_return as "optimisticReturn",
        target_month as "targetMonth", updated_at as "updatedAt"
      from financial_goals where user_id = ${userId} order by user_id
    `.cursor(BATCH_SIZE)) {
      for (const data of rows) {
        yield emit({
          type: "record",
          entity: "financialGoals",
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
  brokerNotes: RecordData<"brokerNotes">[];
  transactions: RecordData<"transactions">[];
  corporateActions: RecordData<"corporateActions">[];
  assetCategories: RecordData<"assetCategories">[];
  scoreConfigs: RecordData<"scoreConfigs">[];
  contributionPlanConfigs: RecordData<"contributionPlanConfigs">[];
  brokerSecurityAliases: RecordData<"brokerSecurityAliases">[];
  incomeTaxSettings: RecordData<"incomeTaxSettings">[];
  darfPayments: RecordData<"darfPayments">[];
  assetTaxProfiles: RecordData<"assetTaxProfiles">[];
  foreignCashBalances: RecordData<"foreignCashBalances">[];
  financialGoals: RecordData<"financialGoals">[];
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
    brokerNotes: [],
    transactions: [],
    corporateActions: [],
    assetCategories: [],
    scoreConfigs: [],
    contributionPlanConfigs: [],
    brokerSecurityAliases: [],
    incomeTaxSettings: [],
    darfPayments: [],
    assetTaxProfiles: [],
    foreignCashBalances: [],
    financialGoals: [],
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
      case "brokerNotes":
        parsed.brokerNotes.push(record.data);
        break;
      case "transactions":
        parsed.transactions.push(record.data);
        break;
      case "corporateActions":
        parsed.corporateActions.push(record.data);
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
      case "brokerSecurityAliases":
        parsed.brokerSecurityAliases.push(record.data);
        break;
      case "incomeTaxSettings":
        parsed.incomeTaxSettings.push(record.data);
        break;
      case "darfPayments":
        parsed.darfPayments.push(record.data);
        break;
      case "assetTaxProfiles":
        parsed.assetTaxProfiles.push(record.data);
        break;
      case "foreignCashBalances":
        parsed.foreignCashBalances.push(record.data);
        break;
      case "financialGoals":
        parsed.financialGoals.push(record.data);
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
  if (parsed.incomeTaxSettings.length > 1) {
    throw new Error("Backup contains more than one set of income tax balances");
  }
  if (parsed.financialGoals.length > 1) {
    throw new Error("Backup contains more than one goal");
  }
  const unique = (values: readonly (string | number)[], what: string) => {
    if (new Set(values).size !== values.length) {
      throw new Error(`Backup repeats ${what}`);
    }
  };
  unique(
    parsed.darfPayments.map((row) => row.month),
    "a DARF payment month",
  );
  unique(
    parsed.assetTaxProfiles.map((row) => row.ticker),
    "a ticker's tax details",
  );
  unique(
    parsed.foreignCashBalances.map((row) => row.year),
    "a foreign cash year",
  );

  // Replaying a backup must never smuggle in a state a live write would refuse.
  assertBackupTransactionsValid(parsed.transactions, parsed.corporateActions);
  assertBackupBrokerNotesValid(
    parsed.brokerNotes,
    parsed.transactions,
    parsed.brokerSecurityAliases,
  );

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
    await tx.delete(brokerNotes).where(eq(brokerNotes.userId, userId));
    await tx
      .delete(brokerSecurityAliases)
      .where(eq(brokerSecurityAliases.userId, userId));
    await tx
      .delete(corporateActions)
      .where(eq(corporateActions.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));
    await tx
      .delete(userScoreConfigs)
      .where(eq(userScoreConfigs.userId, userId));
    await tx
      .delete(userContributionPlanConfigs)
      .where(eq(userContributionPlanConfigs.userId, userId));
    await tx
      .delete(incomeTaxSettings)
      .where(eq(incomeTaxSettings.userId, userId));
    await tx.delete(darfPayments).where(eq(darfPayments.userId, userId));
    await tx
      .delete(assetTaxProfiles)
      .where(eq(assetTaxProfiles.userId, userId));
    await tx
      .delete(foreignCashBalances)
      .where(eq(foreignCashBalances.userId, userId));
    await tx.delete(financialGoals).where(eq(financialGoals.userId, userId));

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

    const brokerNoteIdByRef = new Map<string, string>();
    for (
      let index = 0;
      index < parsed.brokerNotes.length;
      index += BATCH_SIZE
    ) {
      await tx.insert(brokerNotes).values(
        parsed.brokerNotes
          .slice(index, index + BATCH_SIZE)
          .map(({ ref, ...row }) => {
            const id = randomUUID();
            brokerNoteIdByRef.set(ref, id);
            return { ...row, id, userId };
          }),
      );
    }

    for (
      let index = 0;
      index < parsed.transactions.length;
      index += BATCH_SIZE
    ) {
      await tx.insert(transactions).values(
        parsed.transactions
          .slice(index, index + BATCH_SIZE)
          .map(({ brokerNoteRef, ...row }) => {
            const brokerNoteId =
              brokerNoteRef === null
                ? null
                : brokerNoteIdByRef.get(brokerNoteRef);
            if (brokerNoteId === undefined) {
              throw new Error("Backup contains a broken broker note reference");
            }
            return { ...row, brokerNoteId, userId };
          }),
      );
    }

    for (
      let index = 0;
      index < parsed.corporateActions.length;
      index += BATCH_SIZE
    ) {
      await tx
        .insert(corporateActions)
        .values(
          parsed.corporateActions
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

    for (
      let index = 0;
      index < parsed.brokerSecurityAliases.length;
      index += BATCH_SIZE
    ) {
      await tx
        .insert(brokerSecurityAliases)
        .values(
          parsed.brokerSecurityAliases
            .slice(index, index + BATCH_SIZE)
            .map((row) => ({ ...row, userId })),
        );
    }

    if (parsed.incomeTaxSettings.length > 0) {
      await tx
        .insert(incomeTaxSettings)
        .values(parsed.incomeTaxSettings.map((row) => ({ ...row, userId })));
    }

    // One row per month, ticker or year: bounded by the account's history.
    if (parsed.darfPayments.length > 0) {
      await tx
        .insert(darfPayments)
        .values(parsed.darfPayments.map((row) => ({ ...row, userId })));
    }

    for (
      let index = 0;
      index < parsed.assetTaxProfiles.length;
      index += BATCH_SIZE
    ) {
      await tx
        .insert(assetTaxProfiles)
        .values(
          parsed.assetTaxProfiles
            .slice(index, index + BATCH_SIZE)
            .map((row) => ({ ...row, userId })),
        );
    }

    if (parsed.foreignCashBalances.length > 0) {
      await tx
        .insert(foreignCashBalances)
        .values(parsed.foreignCashBalances.map((row) => ({ ...row, userId })));
    }

    if (parsed.financialGoals.length > 0) {
      await tx
        .insert(financialGoals)
        .values(parsed.financialGoals.map((row) => ({ ...row, userId })));
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
