import {
  type AssetClass,
  bookHoldingsInput,
  createTransactionInput,
  deleteTransactionInput,
  type Transaction,
  tickerLedgerInput,
  transactionListInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { allocationAssets, transactions } from "../../db/schema";
import {
  availableBeforeOversell,
  buildTickerLedger,
  type ConsolidationInput,
  type IdentifiedEntry,
  oversellAfterRemoval,
  type TickerLedgerEntry,
  tickerCurrencies,
  tradeCashTotal,
} from "../../domain/positions";
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
 * Must run inside a transaction: `pg_advisory_xact_lock` releases on commit.
 */
export async function lockTickers(
  tx: DbExecutor,
  userId: string,
  tickers: readonly string[],
): Promise<void> {
  const ordered = [...new Set(tickers)].sort();

  for (const ticker of ordered) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${ticker}`}))`,
    );
  }
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
  notes: transactions.notes,
  createdAt: transactions.createdAt,
};

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

export async function loadTransactions(
  userId: string,
): Promise<ConsolidationInput[]> {
  const rows = await db
    .select(calculationColumns)
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt));

  return rows.map((row) => toConsolidationInput(row));
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

  const rows = await db
    .select(calculationColumns)
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.ticker, [...new Set(tickers)]),
      ),
    )
    .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt));

  return rows.map((row) => toConsolidationInput(row));
}

function toDto(row: ConsolidationInput & { id: string; notes: string | null }) {
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
    notes: row.notes,
    total: tradeCashTotal(row),
  } satisfies Transaction;
}

export const transactionsRouter = router({
  list: protectedProcedure
    .input(transactionListInput)
    .query(async ({ ctx, input }) => {
      const [rows, totals] = await Promise.all([
        db
          .select(displayColumns)
          .from(transactions)
          .where(eq(transactions.userId, ctx.user.id))
          .orderBy(
            desc(transactions.tradedAt),
            desc(transactions.createdAt),
            desc(transactions.id),
          )
          .limit(input.pageSize)
          .offset(input.page * input.pageSize),
        db
          .select({ value: count() })
          .from(transactions)
          .where(eq(transactions.userId, ctx.user.id)),
      ]);

      return {
        items: rows.map(toDto),
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
      const rows = await db
        .select(displayColumns)
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, ctx.user.id),
            eq(transactions.ticker, input.ticker),
          ),
        );

      const entries: TickerLedgerEntry[] = rows.map((row) => {
        const rawClass: string = row.assetClass;

        return {
          ...row,
          assetClass: (rawClass === "stock"
            ? "stock_br"
            : row.assetClass) as AssetClass,
        };
      });

      return buildTickerLedger(input.ticker, entries);
    }),

  create: protectedProcedure
    .input(createTransactionInput)
    .mutation(async ({ ctx, input }) => {
      const trade = input;
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

        const available = availableBeforeOversell(
          [...history, { ...trade, createdAt: new Date() }],
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

      return inserted.map(toDto);
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
