import {
  createBonusInput,
  createSplitInput,
  removeSplitInput,
  type Split,
  type SplitSuggestion,
  splitListInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { corporateActions } from "../../db/schema";
import { apiToday } from "../../domain/performance";
import {
  adjustForSplits,
  availableBeforeOversell,
  pendingSplitSuggestions,
  unitsHeldBefore,
} from "../../domain/positions";
import { yahooPublishedSplits } from "../../lib/corporate-actions/yahoo";
import { add, formatDecimal, toDecimal, ZERO } from "../../lib/decimal";
import { protectedProcedure, router } from "../trpc";
import { lockTickers, readSplits, readTickerHistory } from "./transactions";

const splitColumns = {
  id: corporateActions.id,
  ticker: corporateActions.ticker,
  kind: corporateActions.kind,
  effectiveAt: corporateActions.effectiveAt,
  fromQuantity: corporateActions.fromQuantity,
  toQuantity: corporateActions.toQuantity,
  unitCost: corporateActions.unitCost,
  notes: corporateActions.notes,
};

function oversellMessage(ticker: string, available: string): string {
  return `This would oversell ${ticker}: only ${available} would be available for a later sale.`;
}

export const corporateActionsRouter = router({
  /** Recorded splits of one ticker, oldest first. */
  list: protectedProcedure.input(splitListInput).query(
    async ({ ctx, input }): Promise<Split[]> =>
      db
        .select(splitColumns)
        .from(corporateActions)
        .where(
          and(
            eq(corporateActions.userId, ctx.user.id),
            eq(corporateActions.ticker, input.ticker),
          ),
        )
        .orderBy(asc(corporateActions.effectiveAt)),
  ),

  /**
   * Records a split or reverse split. The ledger must already hold the
   * ticker before `effectiveAt`, and the new units must keep every later
   * sale covered: a reverse split recorded after sales typed in the old
   * units would otherwise leave them uncovered.
   */
  createSplit: protectedProcedure
    .input(createSplitInput)
    .mutation(async ({ ctx, input }): Promise<Split> => {
      const row = await db.transaction(async (tx) => {
        await lockTickers(tx, ctx.user.id, [input.ticker]);
        const [history, splits] = await Promise.all([
          readTickerHistory(tx, ctx.user.id, [input.ticker]),
          readSplits(tx, ctx.user.id, [input.ticker]),
        ]);

        if (
          history.some(
            (entry) =>
              entry.assetClass === "fixed_income" ||
              entry.assetClass === "cash",
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only share-based assets can split.",
          });
        }

        if (!history.some((entry) => entry.tradedAt < input.effectiveAt)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No ${input.ticker} trade before ${input.effectiveAt}.`,
          });
        }

        if (splits.some((split) => split.effectiveAt === input.effectiveAt)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A split of ${input.ticker} on ${input.effectiveAt} is already recorded.`,
          });
        }

        const available = availableBeforeOversell(
          adjustForSplits(history, [...splits, input]),
          input.ticker,
        );

        if (available !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: oversellMessage(input.ticker, available),
          });
        }

        const [created] = await tx
          .insert(corporateActions)
          .values({
            userId: ctx.user.id,
            ticker: input.ticker,
            kind: "split",
            effectiveAt: input.effectiveAt,
            fromQuantity: input.fromQuantity,
            toQuantity: input.toQuantity,
            notes: input.notes && input.notes.length > 0 ? input.notes : null,
          })
          .returning(splitColumns);

        return created;
      });

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      return row;
    }),

  /**
   * Records a bonus issue of a B3 asset. The shares received become a units
   * ratio over what the ledger held the day before the ex-date, so every
   * screen counts them like a split; the attributed cost only enters the
   * income tax ledger.
   */
  createBonus: protectedProcedure
    .input(createBonusInput)
    .mutation(async ({ ctx, input }): Promise<Split> => {
      const row = await db.transaction(async (tx) => {
        await lockTickers(tx, ctx.user.id, [input.ticker]);
        const [history, splits] = await Promise.all([
          readTickerHistory(tx, ctx.user.id, [input.ticker]),
          readSplits(tx, ctx.user.id, [input.ticker]),
        ]);
        const last = history.at(-1);

        if (
          last?.currency !== "BRL" ||
          last.assetClass === "fixed_income" ||
          last.assetClass === "cash"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only B3 share-based assets receive bonus shares here.",
          });
        }

        if (splits.some((split) => split.effectiveAt === input.effectiveAt)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A split of ${input.ticker} on ${input.effectiveAt} is already recorded.`,
          });
        }

        const held = unitsHeldBefore(
          history,
          splits,
          input.ticker,
          input.effectiveAt,
        );

        if (held <= ZERO) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No ${input.ticker} held before ${input.effectiveAt}.`,
          });
        }

        const [created] = await tx
          .insert(corporateActions)
          .values({
            userId: ctx.user.id,
            ticker: input.ticker,
            kind: "bonus",
            effectiveAt: input.effectiveAt,
            fromQuantity: formatDecimal(held, 8),
            toQuantity: formatDecimal(
              add(held, toDecimal(input.receivedQuantity)),
              8,
            ),
            unitCost: input.unitCost,
            notes: input.notes && input.notes.length > 0 ? input.notes : null,
          })
          .returning(splitColumns);

        return created;
      });

      if (!row) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      return row;
    }),

  /** Removing a split can uncover sales recorded in its new units. */
  removeSplit: protectedProcedure
    .input(removeSplitInput)
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: corporateActions.id, ticker: corporateActions.ticker })
          .from(corporateActions)
          .where(
            and(
              eq(corporateActions.id, input.id),
              eq(corporateActions.userId, ctx.user.id),
            ),
          )
          .limit(1);

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Split not found",
          });
        }

        await lockTickers(tx, ctx.user.id, [target.ticker]);
        const [history, rows] = await Promise.all([
          readTickerHistory(tx, ctx.user.id, [target.ticker]),
          tx
            .select({
              id: corporateActions.id,
              ticker: corporateActions.ticker,
              effectiveAt: corporateActions.effectiveAt,
              fromQuantity: corporateActions.fromQuantity,
              toQuantity: corporateActions.toQuantity,
            })
            .from(corporateActions)
            .where(
              and(
                eq(corporateActions.userId, ctx.user.id),
                eq(corporateActions.ticker, target.ticker),
              ),
            ),
        ]);
        const available = availableBeforeOversell(
          adjustForSplits(
            history,
            rows.filter((split) => split.id !== target.id),
          ),
          target.ticker,
        );

        if (available !== null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: oversellMessage(target.ticker, available),
          });
        }

        await tx
          .delete(corporateActions)
          .where(
            and(
              eq(corporateActions.id, target.id),
              eq(corporateActions.userId, ctx.user.id),
            ),
          );
      });

      return { id: input.id };
    }),

  /**
   * Splits Yahoo published after the first trade that the ledger does not
   * record yet. A provider failure is reported, never turned into "none".
   */
  suggestions: protectedProcedure
    .input(splitListInput)
    .query(
      async ({
        ctx,
        input,
      }): Promise<{ suggestions: SplitSuggestion[]; unavailable: boolean }> => {
        const [history, recorded] = await Promise.all([
          readTickerHistory(db, ctx.user.id, [input.ticker]),
          readSplits(db, ctx.user.id, [input.ticker]),
        ]);
        const first = history[0];
        const last = history.at(-1);

        if (
          !first ||
          !last ||
          last.assetClass === "fixed_income" ||
          last.assetClass === "cash"
        ) {
          return { suggestions: [], unavailable: false };
        }

        try {
          const published = await yahooPublishedSplits({
            ticker: input.ticker,
            assetClass: last.assetClass,
            currency: last.currency,
            start: first.tradedAt,
            end: apiToday(),
          });

          return {
            suggestions: pendingSplitSuggestions(
              published,
              recorded,
              first.tradedAt,
            ).map((split) => ({ ticker: input.ticker, ...split })),
            unavailable: false,
          };
        } catch {
          return { suggestions: [], unavailable: true };
        }
      },
    ),
});
