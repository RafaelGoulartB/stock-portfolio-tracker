import {
  createTransactionInput,
  deleteTransactionInput,
  type Transaction,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { transactions } from "../../db/schema";
import {
  availableQuantity,
  type ConsolidationInput,
} from "../../domain/positions";
import { add, formatDecimal, mul, sub, toDecimal } from "../../lib/decimal";
import { protectedProcedure, router } from "../trpc";

const columns = {
  id: transactions.id,
  ticker: transactions.ticker,
  assetClass: transactions.assetClass,
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
  return db
    .select(columns)
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.tradedAt), asc(transactions.createdAt));
}

/** Cash moved by the trade: fees increase a buy and reduce a sell. */
function tradeTotal(row: ConsolidationInput): string {
  const gross = mul(toDecimal(row.quantity), toDecimal(row.price));
  const fees = toDecimal(row.fees);

  return formatDecimal(
    row.side === "buy" ? add(gross, fees) : sub(gross, fees),
    2,
  );
}

function toDto(row: ConsolidationInput & { id: string; notes: string | null }) {
  return {
    id: row.id,
    ticker: row.ticker,
    assetClass: row.assetClass,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fees: row.fees,
    tradedAt: row.tradedAt,
    notes: row.notes,
    total: tradeTotal(row),
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

  create: protectedProcedure
    .input(createTransactionInput)
    .mutation(async ({ ctx, input }) => {
      if (input.side === "sell") {
        const held = availableQuantity(
          await loadTransactions(ctx.user.id),
          input.ticker,
        );

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
