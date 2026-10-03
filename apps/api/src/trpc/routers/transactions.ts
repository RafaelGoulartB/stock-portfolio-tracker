import {
  type AssetClass,
  type BrokerNoteFormat,
  bookHoldingsInput,
  createTransactionInput,
  deleteTransactionInput,
  type TradeFxStatus,
  type Transaction,
  tickerLedgerInput,
  transactionListInput,
  updateTransactionInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "../../db";
import {
  allocationAssets,
  brokerNotes,
  corporateActions,
  transactions,
} from "../../db/schema";
import {
  adjustForSplits,
  availableBeforeOversell,
  buildTickerLedger,
  type ConsolidationInput,
  type IdentifiedEntry,
  oversellAfterRemoval,
  oversellAfterReplacement,
  type SplitEvent,
  type TickerLedgerEntry,
  tickerCurrencies,
  tradeCashTotal,
} from "../../domain/positions";
import { tradeDateRateOrNull, tradeDateRates } from "../../lib/fx/trade-rates";
import { memoizeRequest } from "../../lib/request-memo";
import { protectedProcedure, router } from "../trpc";

/** A Drizzle transaction handle, or the base `db`, that runs the query. */
type DbExecutor =
  | Parameters<Parameters<typeof db.transaction>[0]>[0]
  | typeof db;

/**
 * Serializes writes for one account's tickers so simultaneous sales cannot
 * both validate against the same available quantity. Locks are taken in a
 * stable sorted order and deduplicated so two transactions touching the same
 * set of tickers can never deadlock by acquiring them in opposite orders.
 * The lock key (`hashtext` of `userId:ticker`) must stay stable: concurrent
 * API versions have to agree on it.
 * Must run inside a transaction: `pg_advisory_xact_lock` releases on commit.
 */
export async function lockTickers(
  tx: DbExecutor,
  userId: string,
  tickers: readonly string[],
): Promise<void> {
  const ordered = [...new Set(tickers)].sort();

  if (ordered.length === 0) {
    return;
  }

  // One round trip for the whole set. `OFFSET 0` keeps the ordered subquery
  // from being flattened, so the locks are still acquired in sorted order.
  const keys = sql.join(
    ordered.map(
      (ticker, index) => sql`(${index}::int, ${`${userId}:${ticker}`}::text)`,
    ),
    sql`, `,
  );
  await tx.execute(
    sql`SELECT count(pg_advisory_xact_lock(hashtext(ordered.key))) FROM (SELECT key FROM (VALUES ${keys}) AS input(position, key) ORDER BY position OFFSET 0) AS ordered`,
  );
}

/**
 * Re-reads the calculation columns for one account's tickers in trade order.
 * Call after {@link lockTickers} so the history reflects committed writes and
 * cannot change under the mutation.
 */
export async function readTickerHistory(
  tx: DbExecutor,
  userId: string,
  tickers: readonly string[],
): Promise<ConsolidationInput[]> {
  const unique = [...new Set(tickers)];

  if (unique.length === 0) {
    return [];
  }

  const rows = await tx
    .select(calculationColumns)
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.ticker, unique),
      ),
    )
    .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt));

  return rows.map((row) => toConsolidationInput(row));
}

const displayColumns = {
  id: transactions.id,
  ticker: transactions.ticker,
  assetClass: transactions.assetClass,
  currency: transactions.currency,
  side: transactions.side,
  quantity: transactions.quantity,
  price: transactions.price,
  fees: transactions.fees,
  tradedAt: transactions.tradedAt,
  usdBrlRate: transactions.usdBrlRate,
  notes: transactions.notes,
  createdAt: transactions.createdAt,
  brokerNoteId: transactions.brokerNoteId,
};

const IMPORTED_TRADE_LOCKED =
  "This trade was imported from a broker note. Delete the note to remove its trades.";

/** Position calculations never read a row id or user-entered note. */
const calculationColumns = {
  ticker: transactions.ticker,
  assetClass: transactions.assetClass,
  currency: transactions.currency,
  side: transactions.side,
  quantity: transactions.quantity,
  price: transactions.price,
  fees: transactions.fees,
  tradedAt: transactions.tradedAt,
  usdBrlRate: transactions.usdBrlRate,
  createdAt: transactions.createdAt,
};

function toConsolidationInput(
  row: Omit<ConsolidationInput, "assetClass"> & { assetClass: string },
): ConsolidationInput {
  // Rows written before the BR/US stock split still read back as `stock`.
  const rawClass: string = row.assetClass;

  return {
    ...row,
    assetClass: (rawClass === "stock"
      ? "stock_br"
      : row.assetClass) as AssetClass,
  };
}

const splitColumns = {
  ticker: corporateActions.ticker,
  effectiveAt: corporateActions.effectiveAt,
  fromQuantity: corporateActions.fromQuantity,
  toQuantity: corporateActions.toQuantity,
  kind: corporateActions.kind,
  unitCost: corporateActions.unitCost,
};

/**
 * Recorded splits of an account, optionally limited to some tickers. Call
 * after {@link lockTickers} inside a write so the set cannot change under it.
 */
export async function readSplits(
  executor: DbExecutor,
  userId: string,
  tickers?: readonly string[],
): Promise<SplitEvent[]> {
  const unique = tickers ? [...new Set(tickers)] : null;

  if (unique && unique.length === 0) {
    return [];
  }

  return executor
    .select(splitColumns)
    .from(corporateActions)
    .where(
      unique
        ? and(
            eq(corporateActions.userId, userId),
            inArray(corporateActions.ticker, unique),
          )
        : eq(corporateActions.userId, userId),
    )
    .orderBy(asc(corporateActions.effectiveAt));
}

/**
 * Every split for the account, read once per request: the ledger loader,
 * Allocation's fair-value adjustment and the tax report all need the same
 * rows within one batch.
 */
export function loadAccountSplits(userId: string): Promise<SplitEvent[]> {
  return memoizeRequest(`splits:${userId}`, () => readSplits(db, userId));
}

/**
 * The account ledger in today's share units (see `adjustForSplits`), which
 * is what every valuation, snapshot and dividend entitlement reads.
 */
export async function loadTransactions(
  userId: string,
): Promise<ConsolidationInput[]> {
  return memoizeRequest(`transactions:${userId}`, () =>
    loadTransactionsUncached(userId),
  );
}

async function loadTransactionsUncached(
  userId: string,
): Promise<ConsolidationInput[]> {
  const [rows, splits] = await Promise.all([
    db
      .select(calculationColumns)
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt)),
    loadAccountSplits(userId),
  ]);

  return adjustForSplits(
    rows.map((row) => toConsolidationInput(row)),
    splits,
  );
}

/**
 * Like {@link readTickerHistory} but keeps each row's id, so a mutation can
 * target one entry (e.g. simulate its removal). Trade order and locking
 * expectations are identical.
 */
export async function readIdentifiedHistory(
  tx: DbExecutor,
  userId: string,
  tickers: readonly string[],
): Promise<IdentifiedEntry[]> {
  const unique = [...new Set(tickers)];

  if (unique.length === 0) {
    return [];
  }

  const rows = await tx
    .select({ id: transactions.id, ...calculationColumns })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.ticker, unique),
      ),
    )
    .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt));

  return rows.map((row) => {
    const { id, ...rest } = row;

    return { ...toConsolidationInput(rest), id } satisfies IdentifiedEntry;
  });
}

/** Reads only the ticker ledgers needed by a mutation. */
export async function loadTransactionsForTickers(
  userId: string,
  tickers: readonly string[],
): Promise<ConsolidationInput[]> {
  if (tickers.length === 0) {
    return [];
  }

  const [rows, splits] = await Promise.all([
    db
      .select(calculationColumns)
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          inArray(transactions.ticker, [...new Set(tickers)]),
        ),
      )
      .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt)),
    readSplits(db, userId, tickers),
  ]);

  return adjustForSplits(
    rows.map((row) => toConsolidationInput(row)),
    splits,
  );
}

function toDto(
  row: ConsolidationInput & {
    id: string;
    notes: string | null;
    brokerNoteId: string | null;
  },
  note: { format: string; noteNumber: string | null } | null = null,
) {
  // Rows written before the BR/US stock split read back as `stock`.
  const rawClass: string = row.assetClass;
  const assetClass: AssetClass =
    rawClass === "stock" ? "stock_br" : row.assetClass;

  return {
    id: row.id,
    ticker: row.ticker,
    assetClass,
    currency: row.currency,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fees: row.fees,
    tradedAt: row.tradedAt,
    usdBrlRate: row.usdBrlRate ?? null,
    notes: row.notes,
    total: tradeCashTotal(row),
    brokerNote:
      row.brokerNoteId && note
        ? {
            id: row.brokerNoteId,
            format: note.format as BrokerNoteFormat,
            noteNumber: note.noteNumber,
          }
        : null,
  } satisfies Transaction;
}

/** Escapes `LIKE` wildcards so a typed `%` or `_` matches literally. */
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export const transactionsRouter = router({
  list: protectedProcedure
    .input(transactionListInput)
    .query(async ({ ctx, input }) => {
      const filters: SQL[] = [eq(transactions.userId, ctx.user.id)];

      if (input.ticker) {
        filters.push(ilike(transactions.ticker, likeContains(input.ticker)));
      }

      const where = and(...filters);
      const [rows, totals] = await Promise.all([
        db
          .select({
            ...displayColumns,
            brokerNoteFormat: brokerNotes.format,
            brokerNoteNumber: brokerNotes.noteNumber,
          })
          .from(transactions)
          .leftJoin(brokerNotes, eq(brokerNotes.id, transactions.brokerNoteId))
          .where(where)
          .orderBy(
            desc(transactions.tradedAt),
            desc(transactions.createdAt),
            desc(transactions.id),
          )
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        db.select({ value: count() }).from(transactions).where(where),
      ]);

      return {
        items: rows.map(({ brokerNoteFormat, brokerNoteNumber, ...row }) =>
          toDto(
            row,
            brokerNoteFormat
              ? { format: brokerNoteFormat, noteNumber: brokerNoteNumber }
              : null,
          ),
        ),
        total: Number(totals[0]?.value ?? 0),
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Buys and sells of one ticker, with moving-average realized P&L on each
   * sell. Used by the allocation asset page.
   */
  forTicker: protectedProcedure
    .input(tickerLedgerInput)
    .query(async ({ ctx, input }) => {
      const [rows, splits] = await Promise.all([
        db
          .select(displayColumns)
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, ctx.user.id),
              eq(transactions.ticker, input.ticker),
            ),
          ),
        readSplits(db, ctx.user.id, [input.ticker]),
      ]);

      const entries: TickerLedgerEntry[] = rows.map((row) => {
        const rawClass: string = row.assetClass;

        return {
          ...row,
          assetClass: (rawClass === "stock"
            ? "stock_br"
            : row.assetClass) as AssetClass,
        };
      });

      return buildTickerLedger(input.ticker, adjustForSplits(entries, splits));
    }),

  create: protectedProcedure
    .input(createTransactionInput)
    .mutation(async ({ ctx, input }) => {
      const trade = input;
      // Resolved before the ledger lock so a slow BCB call never holds it.
      const usdBrlRate =
        trade.usdBrlRate ?? (await tradeDateRateOrNull(trade.tradedAt));
      const row = await db.transaction(async (tx) => {
        // Serialize writes for one account/ticker so simultaneous sales do
        // not both validate against the same available quantity.
        await lockTickers(tx, ctx.user.id, [trade.ticker]);
        const history = await readTickerHistory(tx, ctx.user.id, [
          trade.ticker,
        ]);

        if (
          trade.assetClass === "fixed_income" &&
          history.some((entry) => entry.ticker === trade.ticker)
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A fixed-income balance with this name already exists. Update its value from Allocation.",
          });
        }

        // One ticker, one currency: costs in BRL and USD must never be averaged.
        const used = tickerCurrencies(history, trade.ticker);
        if (used.length > 0 && !used.includes(trade.currency)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Ticker ${trade.ticker} is tracked in ${used.join(", ")}. Register this trade in the same currency.`,
          });
        }

        // A backdated trade before a recorded split is scaled like the rest.
        const splits = await readSplits(tx, ctx.user.id, [trade.ticker]);
        const available = availableBeforeOversell(
          adjustForSplits(
            [...history, { ...trade, createdAt: new Date() }],
            splits,
          ),
          trade.ticker,
        );
        if (available !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `You only hold ${available} ${trade.ticker}`,
          });
        }

        const [created] = await tx
          .insert(transactions)
          .values({
            userId: ctx.user.id,
            ticker: trade.ticker,
            assetClass: trade.assetClass,
            currency: trade.currency,
            side: trade.side,
            quantity: trade.quantity,
            price: trade.price,
            fees: trade.fees,
            tradedAt: trade.tradedAt,
            usdBrlRate,
            notes: trade.notes && trade.notes.length > 0 ? trade.notes : null,
          })
          .returning(displayColumns);

        if (!created) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        }

        if (trade.assetClass === "fixed_income") {
          await tx
            .insert(allocationAssets)
            .values({
              userId: ctx.user.id,
              ticker: trade.ticker,
              assetClass: trade.assetClass,
              currency: trade.currency,
              manualPrice: trade.price,
            })
            .onConflictDoUpdate({
              target: [allocationAssets.userId, allocationAssets.ticker],
              set: { manualPrice: trade.price, updatedAt: new Date() },
            });
        }

        return created;
      });

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      return toDto(row);
    }),

  /**
   * Books opening lots as synthetic buys (quantity × average cost, fees 0).
   * Locks every ticker in a stable order, re-reads their history under the
   * locks, validates the one-currency-per-ticker rule, then inserts
   * all-or-nothing.
   */
  bookHoldings: protectedProcedure
    .input(bookHoldingsInput)
    .mutation(async ({ ctx, input }) => {
      const seen = new Set<string>();

      for (const holding of input.holdings) {
        if (seen.has(holding.ticker)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Duplicate ticker ${holding.ticker} in this batch`,
          });
        }

        seen.add(holding.ticker);
      }

      const note =
        input.notes && input.notes.length > 0
          ? input.notes
          : "Opening position";
      const batchTickers = input.holdings.map((holding) => holding.ticker);
      const usdBrlRate = await tradeDateRateOrNull(input.tradedAt);

      const inserted = await db.transaction(async (tx) => {
        // Lock in a deterministic order across the whole batch so two
        // concurrent bookings sharing tickers cannot deadlock, then read the
        // committed history under those locks.
        await lockTickers(tx, ctx.user.id, batchTickers);
        const history = await readTickerHistory(tx, ctx.user.id, batchTickers);

        for (const holding of input.holdings) {
          // One ticker, one currency: BRL and USD costs are never averaged.
          const used = tickerCurrencies(history, holding.ticker);

          if (used.length > 0 && !used.includes(holding.currency)) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Ticker ${holding.ticker} is tracked in ${used.join(", ")}. Register this trade in the same currency.`,
            });
          }
        }

        const rows = [];

        for (const holding of input.holdings) {
          const [row] = await tx
            .insert(transactions)
            .values({
              userId: ctx.user.id,
              ticker: holding.ticker,
              assetClass: holding.assetClass,
              currency: holding.currency,
              side: "buy",
              quantity: holding.quantity,
              price: holding.price,
              fees: "0",
              tradedAt: input.tradedAt,
              usdBrlRate,
              notes: note,
            })
            .returning(displayColumns);

          if (!row) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          }

          rows.push(row);
        }

        return rows;
      });

      return inserted.map((row) => toDto(row));
    }),

  /**
   * Rewrites one trade in place. Fixed-income balances stay maintained from
   * Allocation, so neither side of the edit may be fixed income. Both the
   * old and the new ticker are locked and replayed, because moving, shrinking
   * or renaming a buy can retroactively oversell a later sell.
   */
  update: protectedProcedure
    .input(updateTransactionInput)
    .mutation(async ({ ctx, input }) => {
      const trade = input.trade;

      if (trade.assetClass === "fixed_income") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fixed-income balances are maintained from Allocation.",
        });
      }

      const usdBrlRate =
        trade.usdBrlRate ?? (await tradeDateRateOrNull(trade.tradedAt));
      const row = await db.transaction(async (tx) => {
        const [target] = await tx
          .select({
            ticker: transactions.ticker,
            brokerNoteId: transactions.brokerNoteId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, input.id),
              eq(transactions.userId, ctx.user.id),
            ),
          )
          .limit(1);

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        // An imported trade is the document's; only its note can remove it.
        if (target.brokerNoteId !== null) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: IMPORTED_TRADE_LOCKED,
          });
        }

        await lockTickers(tx, ctx.user.id, [target.ticker, trade.ticker]);
        const history = await readIdentifiedHistory(tx, ctx.user.id, [
          target.ticker,
          trade.ticker,
        ]);
        const current = history.find((entry) => entry.id === input.id);

        // The ticker may have changed between the unlocked read and the lock.
        if (!current || current.ticker !== target.ticker) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This trade changed meanwhile. Reload and try again.",
          });
        }

        if (current.assetClass === "fixed_income") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Fixed-income balances are maintained from Allocation.",
          });
        }

        // One ticker, one currency, judged without the trade being replaced.
        const others = history.filter((entry) => entry.id !== input.id);
        const used = tickerCurrencies(others, trade.ticker);
        if (used.length > 0 && !used.includes(trade.currency)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Ticker ${trade.ticker} is tracked in ${used.join(", ")}. Register this trade in the same currency.`,
          });
        }

        // Keep the original insertion time so same-day ordering is stable.
        const splits = await readSplits(tx, ctx.user.id, [
          target.ticker,
          trade.ticker,
        ]);
        const oversell = oversellAfterReplacement(
          history,
          input.id,
          { ...trade, createdAt: current.createdAt },
          splits,
        );
        if (oversell !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This edit would oversell ${oversell.ticker}: only ${oversell.available} would be available for a later sale.`,
          });
        }

        const [updated] = await tx
          .update(transactions)
          .set({
            ticker: trade.ticker,
            assetClass: trade.assetClass,
            currency: trade.currency,
            side: trade.side,
            quantity: trade.quantity,
            price: trade.price,
            fees: trade.fees,
            tradedAt: trade.tradedAt,
            usdBrlRate,
            notes: trade.notes && trade.notes.length > 0 ? trade.notes : null,
          })
          .where(
            and(
              eq(transactions.id, input.id),
              eq(transactions.userId, ctx.user.id),
            ),
          )
          .returning(displayColumns);

        if (!updated) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        }

        return updated;
      });

      return toDto(row);
    }),

  /** How many of the account's trades still lack a trade-date USD/BRL. */
  tradeFxStatus: protectedProcedure.query(
    async ({ ctx }): Promise<TradeFxStatus> => {
      const rows = await db
        .select({ currency: transactions.currency, value: count() })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, ctx.user.id),
            isNull(transactions.usdBrlRate),
          ),
        )
        .groupBy(transactions.currency);
      const missingByCurrency: TradeFxStatus["missingByCurrency"] = {
        BRL: 0,
        USD: 0,
      };

      for (const row of rows) {
        missingByCurrency[row.currency] = Number(row.value);
      }

      return {
        missing: missingByCurrency.BRL + missingByCurrency.USD,
        missingByCurrency,
      };
    },
  ),

  /**
   * Fills the BCB PTAX of every trade still missing its trade-date rate, in
   * one provider request. Rates never overwrite a stored value, so a rate
   * typed by the user or written by a concurrent edit always wins.
   */
  fillTradeFx: protectedProcedure.mutation(async ({ ctx }) => {
    const pending = await db
      .select({ tradedAt: transactions.tradedAt })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, ctx.user.id),
          isNull(transactions.usdBrlRate),
        ),
      );

    if (pending.length === 0) {
      return { updated: 0, missing: 0 };
    }

    let rates: Awaited<ReturnType<typeof tradeDateRates>>;

    try {
      rates = await tradeDateRates(pending.map((row) => row.tradedAt));
    } catch (error) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message:
          error instanceof Error
            ? `BCB PTAX failed: ${error.message}`
            : "BCB PTAX failed",
      });
    }

    const updated = await db.transaction(async (tx) => {
      let total = 0;

      for (const [tradedAt, point] of rates) {
        const rows = await tx
          .update(transactions)
          .set({ usdBrlRate: point.rate })
          .where(
            and(
              eq(transactions.userId, ctx.user.id),
              eq(transactions.tradedAt, tradedAt),
              isNull(transactions.usdBrlRate),
            ),
          )
          .returning({ id: transactions.id });

        total += rows.length;
      }

      return total;
    });

    return { updated, missing: Math.max(0, pending.length - updated) };
  }),

  remove: protectedProcedure
    .input(deleteTransactionInput)
    .mutation(async ({ ctx, input }) => {
      const deletedId = await db.transaction(async (tx) => {
        // The target's ticker never changes, so reading it before locking is
        // safe; the lock then guards the history we validate and delete from.
        const [target] = await tx
          .select({
            id: transactions.id,
            ticker: transactions.ticker,
            assetClass: transactions.assetClass,
            brokerNoteId: transactions.brokerNoteId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, input.id),
              eq(transactions.userId, ctx.user.id),
            ),
          )
          .limit(1);

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        if (target.brokerNoteId !== null) {
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: IMPORTED_TRADE_LOCKED,
          });
        }

        await lockTickers(tx, ctx.user.id, [target.ticker]);

        // Re-read with ids under the lock so the oversell check sees the
        // committed ledger and the row still exists.
        const history = await readIdentifiedHistory(tx, ctx.user.id, [
          target.ticker,
        ]);

        if (!history.some((entry) => entry.id === target.id)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        // Deleting a buy can retroactively oversell a later sell it covered.
        const available = oversellAfterRemoval(
          history,
          target.ticker,
          target.id,
          await readSplits(tx, ctx.user.id, [target.ticker]),
        );

        if (available !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Removing this trade would oversell ${target.ticker}: only ${available} would be available for a later sale.`,
          });
        }

        const [deleted] = await tx
          .delete(transactions)
          .where(
            and(
              eq(transactions.id, target.id),
              eq(transactions.userId, ctx.user.id),
            ),
          )
          .returning({ id: transactions.id });

        if (!deleted) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        }

        // The manual fixed-income balance only exists while at least one
        // transaction backs it; drop it atomically with its last trade.
        if (target.assetClass === "fixed_income") {
          const remaining = history.some((entry) => entry.id !== target.id);

          if (!remaining) {
            await tx
              .delete(allocationAssets)
              .where(
                and(
                  eq(allocationAssets.userId, ctx.user.id),
                  eq(allocationAssets.ticker, target.ticker),
                ),
              );
          }
        }

        return deleted.id;
      });

      return { id: deletedId };
    }),
});
