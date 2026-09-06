import {
  FX_SOURCE_LABELS,
  type FxRate,
  getFxRateInput,
} from "@portifolio-tracker/shared";
import { TRPCError } from "@trpc/server";
import { getFxProvider, listFxSources } from "../../lib/fx";
import { protectedProcedure, router } from "../trpc";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const fxRouter = router({
  /** Quote sources the user can pick from. New providers appear here. */
  listSources: protectedProcedure.query(() => listFxSources()),

  getRate: protectedProcedure
    .input(getFxRateInput)
    .query(async ({ input }): Promise<FxRate> => {
      if (input.from === input.to) {
        return {
          from: input.from,
          to: input.to,
          rate: "1",
          asOf: todayUtc(),
          source: input.source,
        };
      }

      if (input.source === "manual") {
        if (!input.manualRate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Provide a manual USD/BRL rate",
          });
        }

        return {
          from: input.from,
          to: input.to,
          rate: input.manualRate,
          asOf: todayUtc(),
          source: input.source,
        };
      }

      const provider = getFxProvider(input.source);

      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Unknown FX source: ${input.source}`,
        });
      }

      try {
        return await provider.getQuote({ from: input.from, to: input.to });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            error instanceof Error
              ? `Quote from ${FX_SOURCE_LABELS[input.source]} failed: ${error.message}`
              : "Quote provider failed",
        });
      }
    }),
});
