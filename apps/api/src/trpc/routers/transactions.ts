import {
  type AssetClass,
  bookHoldingsInput,
  createTransactionInput,
  deleteTransactionInput,
  type Transaction,
  tickerLedgerInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { transactions } from "../../db/schema";
import {
  availableQuantity,
  buildTickerLedger,
  type ConsolidationInput,
  type TickerLedgerEntry,
  tickerCurrencies,
  tradeCashTotal,
} from "../../domain/positions";
import { formatDecimal, toDecimal } from "../../lib/decimal";
import { protectedProcedure, router } from "../trpc";

const columns = {
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

export async function loadTransactions(
  userId: string,
): Promise<ConsolidationInput[]> {
  const rows = await db
    .select(columns)
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt));

  // Rows written before the BR/US stock split still read back as `stock`.
  return rows.map((row) => {
    const rawClass: string = row.assetClass;

    return {
      ...row,
      assetClass: (rawClass === "stock"
        ? "stock_br"
        : row.assetClass) as AssetClass,
    };
  });
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
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select(columns)
      .from(transactions)
      .where(eq(transactions.userId, ctx.user.id))
      .orderBy(desc(transactions.tradedAt), desc(transactions.createdAt));

    return rows.map(toDto);
  }),

  /**
   * Buys and sells of one ticker, with moving-average realized P&L on each
   * sell. Used by the allocation asset page.
   */
  forTicker: protectedProcedure
    .input(tickerLedgerInput)
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select(columns)
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
      const history = await loadTransactions(ctx.user.id);

      // One ticker, one currency: costs in BRL and USD must never be averaged
      // together, so the first currency used by a ticker wins.
      const used = tickerCurrencies(history, input.ticker);

      if (used.length > 0 && !used.includes(input.currency)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Ticker ${input.ticker} is tracked in ${used.join(", ")}. Register this trade in the same currency.`,
        });
      }

      if (input.side === "sell") {
        const held = availableQuantity(history, input.ticker);

        if (toDecimal(input.quantity) > toDecimal(held)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `You only hold ${formatDecimal(toDecimal(held), 8)} ${input.ticker}`,
          });
        }
      }

      const [row] = await db
        .insert(transactions)
        .values({
          userId: ctx.user.id,
          ticker: input.ticker,
          assetClass: input.assetClass,
          currency: input.currency,
          side: input.side,
          quantity: input.quantity,
          price: input.price,
          fees: input.fees,
          tradedAt: input.tradedAt,
          notes: input.notes && input.notes.length > 0 ? input.notes : null,
        })
        .returning(columns);

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      return toDto(row);
    }),

  /**
   * Books opening lots as synthetic buys (quantity × average cost, fees 0).
   * Validates every currency lock first, then inserts all-or-nothing.
   */
  bookHoldings: protectedProcedure
    .input(bookHoldingsInput)
    .mutation(async ({ ctx, input }) => {
      const history = await loadTransactions(ctx.user.id);
      const tickers = new Set<string>();

      for (const holding of input.holdings) {
        if (tickers.has(holding.ticker)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Duplicate ticker ${holding.ticker} in this batch`,
          });
        }

        tickers.add(holding.ticker);

        const used = tickerCurrencies(history, holding.ticker);

        if (used.length > 0 && !used.includes(holding.currency)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Ticker ${holding.ticker} is tracked in ${used.join(", ")}. Register this trade in the same currency.`,
          });
        }
      }

      const note =
        input.notes && input.notes.length > 0
          ? input.notes
          : "Opening position";

      const inserted = await db.transaction(async (tx) => {
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
            .returning(columns);

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
      const [deleted] = await db
        .delete(transactions)
        .where(
          and(
            eq(transactions.id, input.id),
            eq(transactions.userId, ctx.user.id),
          ),
        )
        .returning({ id: transactions.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      return deleted;
    }),
});
