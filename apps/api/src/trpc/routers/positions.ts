import { type Position, positionsListInput } from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import {
  consolidatePositions,
  convertPositions,
  summarizePositions,
} from "../../domain/positions";
import { protectedProcedure, router } from "../trpc";
import { loadTransactions } from "./transactions";

export const positionsRouter = router({
  list: protectedProcedure
    .input(positionsListInput)
    .query(async ({ ctx, input }) => {
      const native = consolidatePositions(await loadTransactions(ctx.user.id));
      const needsRate = native.some(
        (position) => position.currency !== input.displayCurrency,
      );

      if (needsRate && !input.usdBrlRate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An USD/BRL rate is required to consolidate mixed currencies",
        });
      }

      let positions: Position[];
      try {
        positions = convertPositions(
          native,
          input.displayCurrency,
          input.usdBrlRate ?? null,
        );
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The USD/BRL rate is invalid",
        });
      }

      return {
        positions,
        summary: summarizePositions(
          positions,
          input.displayCurrency,
          input.usdBrlRate ?? null,
        ),
        fx: {
          displayCurrency: input.displayCurrency,
          usdBrlRate: input.usdBrlRate ?? null,
        },
      };
    }),
});
