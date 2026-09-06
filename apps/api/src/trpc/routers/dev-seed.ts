// DEV-ONLY tRPC router for manual testing. Never import this from
// production domain code.
//
// The procedure below inserts a fixed batch of demo transactions into the
// signed-in account so empty states, mixed BRL/USD consolidation, open and
// closed positions, and realized P&L can be exercised without hand-typing
// trades. It always refuses to run when NODE_ENV is production, keeping
// test tooling out of the production path by construction.

import { createTransactionInput } from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { transactions } from "../../db/schema";
import { DEV_SEED_FIXTURES } from "../../dev/seed-fixtures";
import {
  availableQuantity,
  type ConsolidationInput,
  tickerCurrencies,
} from "../../domain/positions";
import { isProduction } from "../../env";
import { toDecimal } from "../../lib/decimal";
import { protectedProcedure, router } from "../trpc";

export const devSeedRouter = router({
  seedDemo: protectedProcedure.mutation(async ({ ctx }) => {
    if (isProduction) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Demo seeding is disabled in production",
      });
    }

    const history = await db
      .select({
        ticker: transactions.ticker,
        assetClass: transactions.assetClass,
        currency: transactions.currency,
        side: transactions.side,
        quantity: transactions.quantity,
        price: transactions.price,
        fees: transactions.fees,
        tradedAt: transactions.tradedAt,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .where(eq(transactions.userId, ctx.user.id));

    // Replays the same guards as the production create endpoint so the
    // seed batch can never corrupt the one-currency-per-ticker invariant
    // or oversell a holding when the account already has trades.
    const accepted: typeof DEV_SEED_FIXTURES = [];
    const staged: ConsolidationInput[] = [];
    const skippedTickers = new Set<string>();

    // Legacy rows written before the BR/US stock split read as `stock`.
    const normalizedHistory = history.map((row) => ({
      ...row,
      assetClass:
        (row.assetClass as string) === "stock" ? "stock_br" : row.assetClass,
    })) as ConsolidationInput[];

    for (const candidate of DEV_SEED_FIXTURES) {
      const parsed = createTransactionInput.safeParse(candidate);

      if (!parsed.success || skippedTickers.has(parsed.data.ticker)) {
        if (parsed.success) {
          skippedTickers.add(parsed.data.ticker);
        }
        continue;
      }

      const trade = parsed.data;
      const combined = [...normalizedHistory, ...staged];
      const used = tickerCurrencies(combined, trade.ticker);

      if (used.length > 0 && !used.includes(trade.currency)) {
        for (const fixture of DEV_SEED_FIXTURES) {
          if (fixture.ticker === trade.ticker) {
            skippedTickers.add(fixture.ticker);
          }
        }
        continue;
      }

      if (
        trade.side === "sell" &&
        toDecimal(trade.quantity) >
          toDecimal(availableQuantity(combined, trade.ticker))
      ) {
        skippedTickers.add(trade.ticker);
        continue;
      }

      accepted.push(trade);
      staged.push({ ...trade, createdAt: new Date() });
    }

    if (accepted.length === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Demo trades conflict with the tickers already tracked",
      });
    }

    await db.insert(transactions).values(
      accepted.map((trade) => ({
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
      })),
    );

    return {
      inserted: accepted.length,
      skippedTickers: [...skippedTickers].sort(),
    };
  }),
});
